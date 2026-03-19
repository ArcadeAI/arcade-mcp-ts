import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { HTTPSessionManager } from "../src/transports/http-session-manager.js";

/**
 * Create a minimal mock ArcadeMCPServer for testing.
 * The session manager only calls `createSessionServer()` on it.
 */
function createMockServer() {
  const mockMcpServer = {
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as McpServer;

  return {
    createSessionServer: vi.fn().mockReturnValue(mockMcpServer),
    registerSession: vi.fn(),
    unregisterSession: vi.fn(),
    _mockMcpServer: mockMcpServer,
  };
}

/**
 * Build a minimal MCP initialize POST request.
 * The SDK transport expects a valid JSON-RPC initialize message.
 */
function initRequest(url = "http://localhost/mcp", sessionId?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) {
    headers["mcp-session-id"] = sessionId;
  }
  return new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0" },
      },
    }),
  });
}

function getRequest(url = "http://localhost/mcp", sessionId?: string) {
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
  };
  if (sessionId) {
    headers["mcp-session-id"] = sessionId;
  }
  return new Request(url, { method: "GET", headers });
}

describe("HTTPSessionManager", () => {
  describe("stateful mode", () => {
    it("creates a session on POST and returns a session ID", async () => {
      const server = createMockServer();
      const manager = new HTTPSessionManager({
        server: server as never,
      });

      const response = await manager.handleRequest(initRequest());

      // The SDK transport handles the initialize and returns 200
      expect(response.status).toBe(200);
      expect(server.createSessionServer).toHaveBeenCalledTimes(1);
      expect(manager.sessionCount).toBe(1);

      await manager.close();
    });

    it("returns 400 for unknown session ID", async () => {
      const server = createMockServer();
      const manager = new HTTPSessionManager({
        server: server as never,
      });

      const response = await manager.handleRequest(
        initRequest("http://localhost/mcp", "nonexistent-id"),
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("Invalid session");
      expect(manager.sessionCount).toBe(0);

      await manager.close();
    });

    it("returns 400 for GET without session ID", async () => {
      const server = createMockServer();
      const manager = new HTTPSessionManager({
        server: server as never,
      });

      const response = await manager.handleRequest(getRequest());

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("Missing session ID");

      await manager.close();
    });

    it("reuses session for requests with valid session ID", async () => {
      const server = createMockServer();
      const manager = new HTTPSessionManager({
        server: server as never,
      });

      // Create a session
      const initResponse = await manager.handleRequest(initRequest());
      expect(initResponse.status).toBe(200);
      expect(manager.sessionCount).toBe(1);

      // Extract session ID from the response header
      const sessionId = initResponse.headers.get("mcp-session-id");
      expect(sessionId).toBeTruthy();

      // Send a second request with that session ID — should reuse
      const secondResponse = await manager.handleRequest(
        initRequest("http://localhost/mcp", sessionId!),
      );
      // The SDK transport will handle the duplicate initialize
      // but the session manager should NOT create a new session
      expect(server.createSessionServer).toHaveBeenCalledTimes(1);
      expect(manager.sessionCount).toBe(1);

      await manager.close();
    });
  });

  describe("stateless mode", () => {
    it("creates fresh transport per request", async () => {
      const server = createMockServer();
      const manager = new HTTPSessionManager({
        server: server as never,
        stateless: true,
      });

      await manager.handleRequest(initRequest());
      await manager.handleRequest(initRequest());

      // Each request should create a new session server
      expect(server.createSessionServer).toHaveBeenCalledTimes(2);
      // Stateless sessions are not tracked
      expect(manager.sessionCount).toBe(0);

      await manager.close();
    });
  });

  describe("max sessions", () => {
    it("returns 503 when max sessions reached", async () => {
      const server = createMockServer();
      const manager = new HTTPSessionManager({
        server: server as never,
        maxSessions: 1,
      });

      // Create first session
      const first = await manager.handleRequest(initRequest());
      expect(first.status).toBe(200);
      expect(manager.sessionCount).toBe(1);

      // Second should fail
      const second = await manager.handleRequest(initRequest());
      expect(second.status).toBe(503);
      const body = await second.json();
      expect(body.error).toBe("Max sessions reached");

      await manager.close();
    });
  });

  describe("TTL eviction", () => {
    it("evicts session after TTL expires", async () => {
      vi.useFakeTimers();

      const server = createMockServer();
      const manager = new HTTPSessionManager({
        server: server as never,
        sessionTtlMs: 1000,
      });

      const response = await manager.handleRequest(initRequest());
      expect(response.status).toBe(200);
      expect(manager.sessionCount).toBe(1);

      const sessionId = response.headers.get("mcp-session-id");

      // Advance time past TTL
      vi.advanceTimersByTime(1500);

      expect(manager.sessionCount).toBe(0);

      // Request with expired session ID should fail
      const expired = await manager.handleRequest(
        initRequest("http://localhost/mcp", sessionId!),
      );
      expect(expired.status).toBe(400);

      await manager.close();
      vi.useRealTimers();
    });

    it("resets TTL on access", async () => {
      vi.useFakeTimers();

      const server = createMockServer();
      const manager = new HTTPSessionManager({
        server: server as never,
        sessionTtlMs: 1000,
      });

      const response = await manager.handleRequest(initRequest());
      const sessionId = response.headers.get("mcp-session-id")!;

      // Advance 800ms (not yet expired)
      vi.advanceTimersByTime(800);
      expect(manager.sessionCount).toBe(1);

      // Access the session (resets TTL)
      await manager.handleRequest(
        initRequest("http://localhost/mcp", sessionId),
      );

      // Advance another 800ms (1600ms total, but only 800ms since last access)
      vi.advanceTimersByTime(800);
      expect(manager.sessionCount).toBe(1);

      // Advance past TTL from last access
      vi.advanceTimersByTime(300);
      expect(manager.sessionCount).toBe(0);

      await manager.close();
      vi.useRealTimers();
    });
  });

  describe("graceful shutdown", () => {
    it("rejects requests after close", async () => {
      const server = createMockServer();
      const manager = new HTTPSessionManager({
        server: server as never,
      });

      await manager.close();

      const response = await manager.handleRequest(initRequest());
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.error).toBe("Server is shutting down");
    });

    it("closes all sessions on shutdown", async () => {
      const server = createMockServer();
      const manager = new HTTPSessionManager({
        server: server as never,
      });

      // Create two sessions
      await manager.handleRequest(initRequest());
      await manager.handleRequest(initRequest());
      expect(manager.sessionCount).toBe(2);

      await manager.close();
      expect(manager.sessionCount).toBe(0);
    });
  });

  describe("creation lock", () => {
    it("handles concurrent session creation without errors", async () => {
      const server = createMockServer();
      const manager = new HTTPSessionManager({
        server: server as never,
      });

      // Fire multiple concurrent initialization requests
      const results = await Promise.all([
        manager.handleRequest(initRequest()),
        manager.handleRequest(initRequest()),
        manager.handleRequest(initRequest()),
      ]);

      // All should succeed
      for (const response of results) {
        expect(response.status).toBe(200);
      }
      expect(manager.sessionCount).toBe(3);
      expect(server.createSessionServer).toHaveBeenCalledTimes(3);

      await manager.close();
    });
  });

  describe("sessionCount", () => {
    it("reflects active sessions", async () => {
      const server = createMockServer();
      const manager = new HTTPSessionManager({
        server: server as never,
      });

      expect(manager.sessionCount).toBe(0);

      await manager.handleRequest(initRequest());
      expect(manager.sessionCount).toBe(1);

      await manager.handleRequest(initRequest());
      expect(manager.sessionCount).toBe(2);

      await manager.close();
      expect(manager.sessionCount).toBe(0);
    });
  });
});
