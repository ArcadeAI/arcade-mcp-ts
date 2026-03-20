import * as jose from "jose";
import { describe, expect, it } from "vitest";
import { examplePath, startHttpServer } from "./helpers.js";

const WORKER_SECRET = "integration-test-secret";
const SECRET_KEY = new TextEncoder().encode(WORKER_SECRET);

async function createWorkerJWT(): Promise<string> {
  return new jose.SignJWT({ ver: "1" })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("worker")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(SECRET_KEY);
}

describe("HTTP worker route integration", () => {
  it("mounts worker routes when ARCADE_WORKER_SECRET is set", async () => {
    const port = 9000 + Math.floor(Math.random() * 1000);
    const serverProcess = await startHttpServer(
      "bun",
      examplePath("echo"),
      port,
      {
        ARCADE_WORKER_SECRET: WORKER_SECRET,
      },
    );

    try {
      const baseUrl = `http://127.0.0.1:${port}`;

      // Health endpoint should be accessible without auth
      const healthRes = await fetch(`${baseUrl}/worker/health`);
      expect(healthRes.status).toBe(200);
      const health = await healthRes.json();
      expect(health.status).toBe("ok");

      // Tools endpoint should require auth
      const noAuthRes = await fetch(`${baseUrl}/worker/tools`);
      expect(noAuthRes.status).toBe(401);

      // Tools endpoint with raw secret (not JWT) should be rejected
      const rawSecretRes = await fetch(`${baseUrl}/worker/tools`, {
        headers: { Authorization: `Bearer ${WORKER_SECRET}` },
      });
      expect(rawSecretRes.status).toBe(401);

      // Tools endpoint with valid JWT should work
      const jwt = await createWorkerJWT();
      const toolsRes = await fetch(`${baseUrl}/worker/tools`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      expect(toolsRes.status).toBe(200);
      const tools = await toolsRes.json();
      // Response is now a bare array matching Python format
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThanOrEqual(3);
    } finally {
      serverProcess.kill();
    }
  }, 15000);

  it("does NOT mount worker routes when ARCADE_WORKER_SECRET is unset", async () => {
    const port = 9000 + Math.floor(Math.random() * 1000);
    // Explicitly unset the secret
    const serverProcess = await startHttpServer(
      "bun",
      examplePath("echo"),
      port,
      {
        ARCADE_WORKER_SECRET: "",
      },
    );

    try {
      const baseUrl = `http://127.0.0.1:${port}`;

      // Worker health should 404 since routes are not mounted
      const healthRes = await fetch(`${baseUrl}/worker/health`);
      expect(healthRes.status).toBe(404);
    } finally {
      serverProcess.kill();
    }
  }, 15000);
});
