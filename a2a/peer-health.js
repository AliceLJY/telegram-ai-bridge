// A2A Peer Health — 三态熔断器
// 移植自 openclaw-a2a-gateway/src/peer-health.ts（简化版）
// closed → open → half-open → closed

export class PeerHealthManager {
  /**
   * @param {string[]} peerNames - 兄弟 bot 名称列表
   * @param {object} [config]
   * @param {number} [config.failureThreshold] - 连续失败几次开熔断（默认 3）
   * @param {number} [config.resetTimeoutMs] - 熔断后多久尝试半开（默认 30s）
   */
  constructor(peerNames, config = {}) {
    this.failureThreshold = config.failureThreshold ?? 3;
    this.resetTimeoutMs = config.resetTimeoutMs ?? 30_000;
    this.states = new Map();
    this.halfOpenInFlight = new Set();

    for (const name of peerNames) {
      this.states.set(name, {
        circuit: "closed",
        consecutiveFailures: 0,
        lastFailureAt: null,
      });
    }
  }

  /** 检查 peer 是否可用 */
  isAvailable(peerName) {
    const state = this.states.get(peerName);
    if (!state) return true; // 未知 peer 放行

    if (state.circuit === "closed") return true;

    if (state.circuit === "open") {
      // 冷却期过了 → 半开
      if (state.lastFailureAt && Date.now() - state.lastFailureAt >= this.resetTimeoutMs) {
        state.circuit = "half-open";
        this.halfOpenInFlight.add(peerName);
        console.log(`[A2A] peer ${peerName} circuit: open → half-open`);
        return true;
      }
      return false;
    }

    // half-open: 只允许一个请求通过
    if (this.halfOpenInFlight.has(peerName)) return false;
    this.halfOpenInFlight.add(peerName);
    return true;
  }

  /** 记录成功 */
  recordSuccess(peerName) {
    const state = this.states.get(peerName);
    if (!state) return;

    const prev = state.circuit;
    state.consecutiveFailures = 0;
    this.halfOpenInFlight.delete(peerName);

    if (state.circuit !== "closed") {
      state.circuit = "closed";
      console.log(`[A2A] peer ${peerName} circuit: ${prev} → closed`);
    }
  }

  /** 记录失败，可能触发熔断 */
  recordFailure(peerName) {
    const state = this.states.get(peerName);
    if (!state) return;

    state.consecutiveFailures += 1;
    state.lastFailureAt = Date.now();
    this.halfOpenInFlight.delete(peerName);

    // 半开失败 → 回到全开
    if (state.circuit === "half-open") {
      state.circuit = "open";
      console.log(`[A2A] peer ${peerName} circuit: half-open → open (probe failed)`);
      return;
    }

    // 关闭状态下达到阈值 → 开熔断
    if (state.circuit === "closed" && state.consecutiveFailures >= this.failureThreshold) {
      state.circuit = "open";
      console.log(`[A2A] peer ${peerName} circuit: closed → open (${state.consecutiveFailures} failures)`);
    }
  }

  getAllStates() {
    const result = {};
    for (const [name, state] of this.states) {
      result[name] = { ...state };
    }
    return result;
  }
}
