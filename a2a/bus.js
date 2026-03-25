// A2A Bus — HTTP 消息总线
// Bun.serve() 收消息 + fetch() 广播

import { createEnvelope, validateEnvelope } from "./envelope.js";
import { LoopGuard } from "./loop-guard.js";
import { PeerHealthManager } from "./peer-health.js";

/**
 * 创建 A2A 总线
 * @param {object} config
 * @param {string} config.selfName - 当前 bot 名称 (claude/codex/gemini)
 * @param {string} config.selfUsername - TG bot username
 * @param {number} config.port - HTTP 监听端口
 * @param {object} config.peers - { claude: "http://localhost:18810", codex: "http://localhost:18811", ... }
 * @param {object} [config.loopGuard] - 防死循环配置
 * @param {object} [config.circuitBreaker] - 熔断配置
 */
export function createA2ABus(config) {
  const {
    selfName,
    selfUsername = "",
    port,
    peers = {},
    loopGuard = {},
    circuitBreaker = {},
  } = config;

  // 排除自己
  const peerUrls = Object.entries(peers)
    .filter(([name]) => name !== selfName)
    .map(([name, url]) => ({ name, url }));

  const loopGuardInstance = new LoopGuard(loopGuard);
  const peerHealth = new PeerHealthManager(peerUrls.map((p) => p.name), circuitBreaker);

  let server = null;
  let messageHandler = null;
  let relayHandler = null;

  // HTTP server
  function start() {
    if (!port) {
      console.log("[A2A] Bus disabled (no port configured)");
      return;
    }

    server = Bun.serve({
      port,
      hostname: "127.0.0.1",
      fetch(req, env) {
        const url = new URL(req.url);
        if (req.method === "POST" && url.pathname === "/a2a/message") {
          return handleInbound(req);
        }
        if (req.method === "POST" && url.pathname === "/a2a/relay") {
          return handleRelayInbound(req);
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    console.log(`[A2A] Bus listening on http://localhost:${port}`);
  }

  function stop() {
    if (server) {
      server.stop();
      server = null;
    }
    loopGuardInstance.stop();
  }

  // 处理入站消息
  async function handleInbound(req) {
    try {
      const envelope = await req.json();

      // 验证
      const error = validateEnvelope(envelope, { maxGeneration: 2 });
      if (error) {
        console.log(`[A2A] Invalid envelope: ${error.code} - ${error.message}`);
        return Response.json({ status: "rejected", error: error.code, message: error.message }, { status: 400 });
      }

      // 防死循环检查
      const guardResult = loopGuardInstance.shouldProcess(envelope);
      if (!guardResult.allow) {
        console.log(`[A2A] Loop guard blocked: ${guardResult.reason}`);
        return Response.json({ status: "blocked", reason: guardResult.reason });
      }

      // 回调处理
      if (messageHandler) {
        try {
          await messageHandler(envelope, {
            chatId: envelope.chat_id,
            sender: envelope.sender,
            senderUsername: envelope.sender_username,
            generation: envelope.generation,
            content: envelope.content,
            originalPrompt: envelope.original_prompt,
            telegramMessageId: envelope.telegram_message_id,
          });
        } catch (err) {
          console.error(`[A2A] Handler error: ${err.message}`);
          return Response.json({ status: "error", message: err.message });
        }
      }

      return Response.json({ status: "accepted" });
    } catch (err) {
      console.error(`[A2A] Parse error: ${err.message}`);
      return Response.json({ status: "error", message: err.message }, { status: 400 });
    }
  }

  // 处理入站 relay 请求（同步请求-响应，不走 loop guard）
  async function handleRelayInbound(req) {
    try {
      const body = await req.json();
      const { sender, prompt } = body;

      if (!prompt || !sender) {
        return Response.json({ status: "error", message: "missing sender or prompt" }, { status: 400 });
      }

      if (!relayHandler) {
        return Response.json({ status: "error", message: "relay not supported on this instance" }, { status: 501 });
      }

      console.log(`[A2A] Relay request from ${sender}: "${prompt.slice(0, 80)}..."`);

      const response = await relayHandler({ sender, prompt });
      return Response.json({ status: "ok", response: response || "" });
    } catch (err) {
      console.error(`[A2A] Relay handler error: ${err.message}`);
      return Response.json({ status: "error", message: err.message }, { status: 500 });
    }
  }

  /**
   * 发送 relay 请求给指定 peer（点对点，同步等响应）
   * @param {string} targetName - 目标 bot 名称
   * @param {object} opts - { prompt, sender, chatId }
   * @param {number} [timeoutMs=120000] - 超时毫秒
   * @returns {Promise<{ success: boolean, response?: string, error?: string }>}
   */
  async function relay(targetName, opts, timeoutMs = 120000) {
    const peer = peerUrls.find((p) => p.name === targetName);
    if (!peer) {
      return { success: false, error: `unknown peer: ${targetName}` };
    }

    if (!peerHealth.isAvailable(targetName)) {
      return { success: false, error: `${targetName} circuit open (unreachable)` };
    }

    try {
      const res = await fetch(`${peer.url}/a2a/relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender: opts.sender || selfName, prompt: opts.prompt }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const data = await res.json();
      if (res.ok && data.status === "ok") {
        peerHealth.recordSuccess(targetName);
        return { success: true, response: data.response || "" };
      } else {
        peerHealth.recordFailure(targetName);
        return { success: false, error: data.message || `HTTP ${res.status}` };
      }
    } catch (err) {
      peerHealth.recordFailure(targetName);
      const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
      return { success: false, error: isTimeout ? `timeout (${Math.round(timeoutMs / 1000)}s)` : err.message };
    }
  }

  /**
   * 注册 relay 处理回调
   * @param {function} handler - async function({ sender, prompt }) => string
   */
  function onRelay(handler) {
    relayHandler = handler;
  }

  /** 返回所有 peer 名称（不含自己） */
  function getPeerNames() {
    return peerUrls.map((p) => p.name);
  }

  /**
   * 广播消息给所有兄弟 bot
   * @param {object} opts - createEnvelope 的参数
   */
  async function broadcast(opts) {
    if (!port || peerUrls.length === 0) return { sent: 0, failed: 0, skipped: 0 };

    const envelope = createEnvelope({
      ...opts,
      sender: selfName,
      senderUsername: selfUsername,
    });

    const results = { sent: 0, failed: 0, skipped: 0 };

    // 并行发给所有 peer
    await Promise.all(
      peerUrls.map(async ({ name, url }) => {
        // 熔断检查
        if (!peerHealth.isAvailable(name)) {
          results.skipped += 1;
          console.log(`[A2A] Skip ${name} (circuit open)`);
          return;
        }

        try {
          const res = await fetch(`${url}/a2a/message`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(envelope),
            signal: AbortSignal.timeout(5000),
          });

          if (res.ok) {
            results.sent += 1;
            peerHealth.recordSuccess(name);
          } else {
            results.failed += 1;
            peerHealth.recordFailure(name);
            console.log(`[A2A] ${name} returned ${res.status}`);
          }
        } catch (err) {
          results.failed += 1;
          peerHealth.recordFailure(name);
          console.log(`[A2A] ${name} unreachable: ${err.message}`);
        }
      })
    );

    return results;
  }

  /**
   * 注册消息处理回调
   * @param {function} handler - async function(envelope, metadata)
   */
  function onMessage(handler) {
    messageHandler = handler;
  }

  function getStats() {
    return {
      self: selfName,
      port,
      peers: peerUrls.map((p) => p.name),
      loopGuard: loopGuardInstance.getStats(),
      peerHealth: peerHealth.getAllStates(),
    };
  }

  return {
    start,
    stop,
    broadcast,
    onMessage,
    onRelay,
    relay,
    getPeerNames,
    getStats,
  };
}
