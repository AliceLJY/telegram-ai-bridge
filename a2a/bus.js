// A2A Bus — HTTP 消息总线
// Bun.serve() 收消息 + fetch() 广播

import { createEnvelope, validateEnvelope } from "./envelope.js";
import { LoopGuard } from "./loop-guard.js";
import { PeerHealthManager } from "./peer-health.js";

/**
 * Proxy-free fetch for localhost A2A calls.
 * Temporarily strips HTTP(S)_PROXY env vars so Bun's fetch
 * doesn't route localhost traffic through ClashX / other proxies.
 */
async function fetchDirect(url, opts) {
  const keys = ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"];
  const saved = {};
  for (const k of keys) {
    if (k in process.env) { saved[k] = process.env[k]; delete process.env[k]; }
  }
  try {
    return await fetch(url, opts);
  } finally {
    for (const [k, v] of Object.entries(saved)) { process.env[k] = v; }
  }
}

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
        if (req.method === "GET" && url.pathname === "/a2a/status") {
          return Response.json(getStats());
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
          const res = await fetchDirect(`${url}/a2a/message`, {
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
      circuitBreaker: peerHealth.getConfig(),
    };
  }

  return {
    start,
    stop,
    broadcast,
    onMessage,
    getPeerNames,
    getStats,
  };
}
