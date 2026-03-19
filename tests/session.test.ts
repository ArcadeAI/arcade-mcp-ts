import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import { ServerRequestError, SessionError } from "../src/exceptions.js";
import {
  InitializationState,
  NotificationManager,
  RequestManager,
  ServerSession,
} from "../src/session.js";

// ── Helpers ──────────────────────────────────────────────

function createMockServer() {
  const server = {
    createMessage: vi.fn().mockResolvedValue({
      role: "assistant",
      content: { type: "text", text: "hello" },
    }),
    elicitInput: vi.fn().mockResolvedValue({ action: "accept", content: {} }),
    listRoots: vi
      .fn()
      .mockResolvedValue({ roots: [{ uri: "file:///tmp", name: "tmp" }] }),
    notification: vi.fn().mockResolvedValue(undefined),
  };
  return {
    server,
  } as unknown as McpServer;
}

function createSession(overrides?: { requestTimeout?: number }) {
  const mcpServer = createMockServer();
  const session = new ServerSession({
    sessionId: "test-session-1",
    mcpServer,
    ...overrides,
  });
  return { session, mcpServer };
}

// ── RequestManager ───────────────────────────────────────

describe("RequestManager", () => {
  it("delegates createMessage to server", async () => {
    const rm = new RequestManager();
    const mockServer = {
      createMessage: vi.fn().mockResolvedValue({
        role: "assistant",
        content: { type: "text", text: "hi" },
      }),
    };
    const params = { messages: [], maxTokens: 100 };

    const result = await rm.createMessage(mockServer as never, params as never);

    expect(mockServer.createMessage).toHaveBeenCalledWith(params, undefined);
    expect(result).toEqual({
      role: "assistant",
      content: { type: "text", text: "hi" },
    });
  });

  it("delegates elicitInput to server", async () => {
    const rm = new RequestManager();
    const mockServer = {
      elicitInput: vi.fn().mockResolvedValue({ action: "accept" }),
    };

    const result = await rm.elicitInput(
      mockServer as never,
      { message: "pick one" } as never,
    );

    expect(mockServer.elicitInput).toHaveBeenCalled();
    expect(result).toEqual({ action: "accept" });
  });

  it("delegates listRoots to server", async () => {
    const rm = new RequestManager();
    const mockServer = {
      listRoots: vi.fn().mockResolvedValue({ roots: [] }),
    };

    const result = await rm.listRoots(mockServer as never);

    expect(mockServer.listRoots).toHaveBeenCalled();
    expect(result).toEqual({ roots: [] });
  });

  it("throws SessionError when closed", async () => {
    const rm = new RequestManager();
    rm.close();

    await expect(rm.createMessage({} as never, {} as never)).rejects.toThrow(
      SessionError,
    );
    await expect(rm.elicitInput({} as never, {} as never)).rejects.toThrow(
      SessionError,
    );
    await expect(rm.listRoots({} as never)).rejects.toThrow(SessionError);
  });

  it("wraps server errors as ServerRequestError", async () => {
    const rm = new RequestManager();
    const mockServer = {
      createMessage: vi.fn().mockRejectedValue(new Error("transport broken")),
    };

    await expect(
      rm.createMessage(mockServer as never, {} as never),
    ).rejects.toThrow(ServerRequestError);
  });

  it("reports closed state", () => {
    const rm = new RequestManager();
    expect(rm.closed).toBe(false);
    rm.close();
    expect(rm.closed).toBe(true);
  });
});

// ── NotificationManager ──────────────────────────────────

describe("NotificationManager", () => {
  function createSessionEntry(id: string, shouldFail = false) {
    return {
      sessionId: id,
      sendNotification: shouldFail
        ? vi.fn().mockRejectedValue(new Error("disconnected"))
        : vi.fn().mockResolvedValue(undefined),
    } as unknown as ServerSession;
  }

  it("broadcasts to all sessions", async () => {
    const s1 = createSessionEntry("s1");
    const s2 = createSessionEntry("s2");
    const registry = new Map([
      ["s1", s1],
      ["s2", s2],
    ]);
    const nm = new NotificationManager(() => registry);

    const notification = {
      method: "notifications/tools/list_changed",
      params: {},
    } as ServerNotification;
    await nm.broadcast(notification);

    expect(s1.sendNotification).toHaveBeenCalledWith(notification);
    expect(s2.sendNotification).toHaveBeenCalledWith(notification);
  });

  it("broadcasts to filtered sessions", async () => {
    const s1 = createSessionEntry("s1");
    const s2 = createSessionEntry("s2");
    const registry = new Map([
      ["s1", s1],
      ["s2", s2],
    ]);
    const nm = new NotificationManager(() => registry);

    await nm.broadcast({} as ServerNotification, ["s1"]);

    expect(s1.sendNotification).toHaveBeenCalled();
    expect(s2.sendNotification).not.toHaveBeenCalled();
  });

  it("swallows per-session failures", async () => {
    const s1 = createSessionEntry("s1", true);
    const s2 = createSessionEntry("s2");
    const registry = new Map([
      ["s1", s1],
      ["s2", s2],
    ]);
    const nm = new NotificationManager(() => registry);

    // Should not throw
    await nm.broadcast({} as ServerNotification);

    expect(s1.sendNotification).toHaveBeenCalled();
    expect(s2.sendNotification).toHaveBeenCalled();
  });

  it("skips unknown session IDs", async () => {
    const s1 = createSessionEntry("s1");
    const registry = new Map([["s1", s1]]);
    const nm = new NotificationManager(() => registry);

    await nm.broadcast({} as ServerNotification, ["s1", "nonexistent"]);

    expect(s1.sendNotification).toHaveBeenCalled();
  });

  it("notifyToolListChanged sends correct notification", async () => {
    const s1 = createSessionEntry("s1");
    const registry = new Map([["s1", s1]]);
    const nm = new NotificationManager(() => registry);

    await nm.notifyToolListChanged();

    expect(s1.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ method: "notifications/tools/list_changed" }),
    );
  });

  it("notifyResourceListChanged sends correct notification", async () => {
    const s1 = createSessionEntry("s1");
    const registry = new Map([["s1", s1]]);
    const nm = new NotificationManager(() => registry);

    await nm.notifyResourceListChanged();

    expect(s1.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "notifications/resources/list_changed",
      }),
    );
  });

  it("notifyPromptListChanged sends correct notification", async () => {
    const s1 = createSessionEntry("s1");
    const registry = new Map([["s1", s1]]);
    const nm = new NotificationManager(() => registry);

    await nm.notifyPromptListChanged();

    expect(s1.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ method: "notifications/prompts/list_changed" }),
    );
  });
});

// ── ServerSession ────────────────────────────────────────

describe("ServerSession", () => {
  describe("state machine", () => {
    it("starts in NOT_INITIALIZED", () => {
      const { session } = createSession();
      expect(session.initializationState).toBe(
        InitializationState.NOT_INITIALIZED,
      );
      expect(session.isInitialized).toBe(false);
    });

    it("transitions NOT_INITIALIZED -> INITIALIZING -> INITIALIZED", () => {
      const { session } = createSession();

      session.markInitializing();
      expect(session.initializationState).toBe(
        InitializationState.INITIALIZING,
      );

      session.markInitialized(
        { tools: {} },
        { name: "test-client", version: "1.0" },
      );
      expect(session.initializationState).toBe(InitializationState.INITIALIZED);
      expect(session.isInitialized).toBe(true);
      expect(session.clientCapabilities).toEqual({ tools: {} });
      expect(session.clientInfo).toEqual({
        name: "test-client",
        version: "1.0",
      });
    });

    it("throws on invalid transition: INITIALIZING from INITIALIZING", () => {
      const { session } = createSession();
      session.markInitializing();
      expect(() => session.markInitializing()).toThrow(SessionError);
    });

    it("throws on invalid transition: INITIALIZED from NOT_INITIALIZED", () => {
      const { session } = createSession();
      expect(() => session.markInitialized()).toThrow(SessionError);
    });

    it("throws on invalid transition: INITIALIZING from INITIALIZED", () => {
      const { session } = createSession();
      session.markInitializing();
      session.markInitialized();
      expect(() => session.markInitializing()).toThrow(SessionError);
    });
  });

  describe("server-initiated requests", () => {
    it("createMessage delegates to requestManager when initialized", async () => {
      const { session, mcpServer } = createSession();
      session.markInitializing();
      session.markInitialized();

      const params = { messages: [], maxTokens: 100 };
      await session.createMessage(params as never);

      expect((mcpServer.server as any).createMessage).toHaveBeenCalled();
    });

    it("elicitInput delegates to requestManager when initialized", async () => {
      const { session, mcpServer } = createSession();
      session.markInitializing();
      session.markInitialized();

      await session.elicitInput({ message: "choose" } as never);

      expect((mcpServer.server as any).elicitInput).toHaveBeenCalled();
    });

    it("listRoots delegates to requestManager when initialized", async () => {
      const { session, mcpServer } = createSession();
      session.markInitializing();
      session.markInitialized();

      const result = await session.listRoots();

      expect((mcpServer.server as any).listRoots).toHaveBeenCalled();
      expect(result.roots).toHaveLength(1);
    });

    it("createMessage throws SessionError when not initialized", async () => {
      const { session } = createSession();
      await expect(session.createMessage({} as never)).rejects.toThrow(
        SessionError,
      );
    });

    it("elicitInput throws SessionError when not initialized", async () => {
      const { session } = createSession();
      await expect(session.elicitInput({} as never)).rejects.toThrow(
        SessionError,
      );
    });

    it("listRoots throws SessionError when not initialized", async () => {
      const { session } = createSession();
      await expect(session.listRoots()).rejects.toThrow(SessionError);
    });
  });

  describe("notifications", () => {
    it("sendNotification delegates to server.notification()", async () => {
      const { session, mcpServer } = createSession();
      const notification = {
        method: "notifications/tools/list_changed",
        params: {},
      } as ServerNotification;

      await session.sendNotification(notification);

      expect((mcpServer.server as any).notification).toHaveBeenCalledWith(
        notification,
      );
    });
  });

  describe("session data", () => {
    it("get/set/delete works", () => {
      const { session } = createSession();

      expect(session.getData("key")).toBeUndefined();

      session.setData("key", "value");
      expect(session.getData("key")).toBe("value");

      session.setData("num", 42);
      expect(session.getData<number>("num")).toBe(42);

      expect(session.deleteData("key")).toBe(true);
      expect(session.getData("key")).toBeUndefined();
      expect(session.deleteData("key")).toBe(false);
    });
  });

  describe("lifecycle", () => {
    it("touch updates lastAccessedAt", () => {
      const { session } = createSession();
      const initial = session.lastAccessedAt;

      // Small delay to ensure timestamp changes
      const later = initial + 100;
      vi.spyOn(Date, "now").mockReturnValue(later);

      session.touch();
      expect(session.lastAccessedAt).toBe(later);

      vi.restoreAllMocks();
    });

    it("close marks requestManager as closed and clears data", () => {
      const { session } = createSession();
      session.setData("key", "value");

      session.close();

      expect(session.requestManager.closed).toBe(true);
      expect(session.getData("key")).toBeUndefined();
    });

    it("stores sessionId and createdAt", () => {
      const { session } = createSession();
      expect(session.sessionId).toBe("test-session-1");
      expect(session.createdAt).toBeGreaterThan(0);
    });
  });
});
