import { describe, expect, test } from "bun:test";
import net from "node:net";

import { createA2ABus } from "./bus.js";

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address.port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

describe("A2A status endpoint", () => {
  test("returns bus stats as JSON", async () => {
    const port = await getFreePort();
    const bus = createA2ABus({
      selfName: "claude",
      port,
      peers: { codex: "http://127.0.0.1:18811" },
    });

    bus.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/a2a/status`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.self).toBe("claude");
      expect(body.port).toBe(port);
      expect(body.peers).toEqual(["codex"]);
      expect(body.loopGuard.activeLayers).toEqual(["generation", "idempotency"]);
    } finally {
      bus.stop();
    }
  });
});
