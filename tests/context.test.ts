import { describe, expect, it, vi } from "vitest";
import {
  Context,
  getCurrentContext,
  setCurrentContext,
} from "../src/context.js";
import { makeExtra } from "./helpers.js";

describe("Context", () => {
  it("creates with defaults", () => {
    const ctx = new Context(makeExtra(), {
      requestId: "req-123",
      sessionId: "session-456",
    });

    expect(ctx.requestId).toBe("req-123");
    expect(ctx.sessionId).toBe("session-456");
    expect(ctx.signal).toBeInstanceOf(AbortSignal);
  });

  it("getSecret returns secret value", () => {
    const ctx = new Context(makeExtra(), {
      requestId: "req",
      toolContext: {
        secrets: { API_KEY: "abc123" },
        metadata: {},
      },
    });

    expect(ctx.getSecret("API_KEY")).toBe("abc123");
  });

  it("getSecret throws for missing secret", () => {
    const ctx = new Context(makeExtra(), {
      requestId: "req",
      toolContext: { secrets: {}, metadata: {} },
    });

    expect(() => ctx.getSecret("MISSING")).toThrow(
      "Secret 'MISSING' not found",
    );
  });

  it("getAuthToken returns token", () => {
    const ctx = new Context(makeExtra(), {
      requestId: "req",
      toolContext: {
        authToken: "token123",
        secrets: {},
        metadata: {},
      },
    });

    expect(ctx.getAuthToken()).toBe("token123");
  });

  it("getAuthToken throws when missing", () => {
    const ctx = new Context(makeExtra(), {
      requestId: "req",
      toolContext: { secrets: {}, metadata: {} },
    });

    expect(() => ctx.getAuthToken()).toThrow("Auth token not found");
  });

  it("getAuthTokenOrEmpty returns empty string when missing", () => {
    const ctx = new Context(makeExtra(), {
      requestId: "req",
      toolContext: { secrets: {}, metadata: {} },
    });

    expect(ctx.getAuthTokenOrEmpty()).toBe("");
  });

  it("userId comes from resource owner", () => {
    const ctx = new Context(makeExtra(), {
      requestId: "req",
      resourceOwner: {
        userId: "user-from-token",
        claims: {},
      },
    });

    expect(ctx.userId).toBe("user-from-token");
  });

  it("userId falls back to toolContext", () => {
    const ctx = new Context(makeExtra(), {
      requestId: "req",
      toolContext: {
        secrets: {},
        metadata: {},
        userId: "user-from-settings",
      },
    });

    expect(ctx.userId).toBe("user-from-settings");
  });

  it("setToolContext / getToolContext round-trips", () => {
    const ctx = new Context(makeExtra(), {
      requestId: "req",
    });

    ctx.setToolContext({
      secrets: { KEY: "val" },
      metadata: { foo: "bar" },
      authToken: "tok",
    });

    const data = ctx.getToolContext();
    expect(data.secrets.KEY).toBe("val");
    expect(data.authToken).toBe("tok");
  });
});

describe("getCurrentContext / setCurrentContext", () => {
  it("starts null", () => {
    setCurrentContext(null);
    expect(getCurrentContext()).toBeNull();
  });

  it("sets and gets context", () => {
    const ctx = new Context(makeExtra(), { requestId: "req" });
    setCurrentContext(ctx);
    expect(getCurrentContext()).toBe(ctx);
    setCurrentContext(null); // cleanup
  });

  it("returns previous context on set", () => {
    const ctx1 = new Context(makeExtra(), { requestId: "req1" });
    const ctx2 = new Context(makeExtra(), { requestId: "req2" });

    setCurrentContext(ctx1);
    const prev = setCurrentContext(ctx2);
    expect(prev).toBe(ctx1);
    expect(getCurrentContext()).toBe(ctx2);
    setCurrentContext(null);
  });
});

describe("Context facades", () => {
  it("has log facade", () => {
    const ctx = new Context(makeExtra(), { requestId: "req" });
    expect(ctx.log).toBeDefined();
    // Should not throw
    ctx.log.info("test message");
    ctx.log.debug("debug");
    ctx.log.warning("warn");
    ctx.log.error("err");
  });

  it("has progress facade", () => {
    const ctx = new Context(makeExtra(), { requestId: "req" });
    expect(ctx.progress).toBeDefined();
  });

  it("has sampling facade", () => {
    const ctx = new Context(makeExtra(), { requestId: "req" });
    expect(ctx.sampling).toBeDefined();
  });

  it("has ui facade", () => {
    const ctx = new Context(makeExtra(), { requestId: "req" });
    expect(ctx.ui).toBeDefined();
  });

  it("has notifications facade", () => {
    const ctx = new Context(makeExtra(), { requestId: "req" });
    expect(ctx.notifications).toBeDefined();
    expect(typeof ctx.notifications.send).toBe("function");
  });

  it("notifications.send() delegates to extra.sendNotification", async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const extra = {
      signal: new AbortController().signal,
      requestId: "req",
      sendNotification,
      sendRequest: async () => ({}),
    } as never;
    const ctx = new Context(extra, { requestId: "req" });

    const notification = {
      method: "notifications/progress" as const,
      params: { progress: 50 },
    };
    await ctx.notifications.send(notification as never);

    expect(sendNotification).toHaveBeenCalledWith(notification);
  });
});

describe("Notification sub-facades", () => {
  function makeCtxWithMock() {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const extra = {
      signal: new AbortController().signal,
      requestId: "req",
      sendNotification,
      sendRequest: async () => ({}),
    } as never;
    const ctx = new Context(extra, { requestId: "req" });
    return { ctx, sendNotification };
  }

  it("notifications.tools.listChanged() sends correct method on flush", async () => {
    const { ctx, sendNotification } = makeCtxWithMock();
    await ctx.notifications.tools.listChanged();
    await ctx.notifications.flush();

    expect(sendNotification).toHaveBeenCalledWith({
      method: "notifications/tools/list_changed",
      params: {},
    });
  });

  it("notifications.resources.listChanged() sends correct method on flush", async () => {
    const { ctx, sendNotification } = makeCtxWithMock();
    await ctx.notifications.resources.listChanged();
    await ctx.notifications.flush();

    expect(sendNotification).toHaveBeenCalledWith({
      method: "notifications/resources/list_changed",
      params: {},
    });
  });

  it("notifications.prompts.listChanged() sends correct method on flush", async () => {
    const { ctx, sendNotification } = makeCtxWithMock();
    await ctx.notifications.prompts.listChanged();
    await ctx.notifications.flush();

    expect(sendNotification).toHaveBeenCalledWith({
      method: "notifications/prompts/list_changed",
      params: {},
    });
  });

  it("deduplicates repeated notifications", async () => {
    const { ctx, sendNotification } = makeCtxWithMock();
    await ctx.notifications.tools.listChanged();
    await ctx.notifications.tools.listChanged();
    await ctx.notifications.tools.listChanged();
    await ctx.notifications.flush();

    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("flush clears queue — second flush is a no-op", async () => {
    const { ctx, sendNotification } = makeCtxWithMock();
    await ctx.notifications.tools.listChanged();
    await ctx.notifications.flush();
    await ctx.notifications.flush();

    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("flush sends multiple distinct notification types", async () => {
    const { ctx, sendNotification } = makeCtxWithMock();
    await ctx.notifications.tools.listChanged();
    await ctx.notifications.resources.listChanged();
    await ctx.notifications.prompts.listChanged();
    await ctx.notifications.flush();

    expect(sendNotification).toHaveBeenCalledTimes(3);
  });

  it("errors in sendNotification do not propagate from flush", async () => {
    const sendNotification = vi.fn().mockRejectedValue(new Error("fail"));
    const extra = {
      signal: new AbortController().signal,
      requestId: "req",
      sendNotification,
      sendRequest: async () => ({}),
    } as never;
    const ctx = new Context(extra, { requestId: "req" });

    await ctx.notifications.tools.listChanged();
    // Should not throw
    await ctx.notifications.flush();
  });

  it("has sub-facade properties", () => {
    const { ctx } = makeCtxWithMock();
    expect(ctx.notifications.tools).toBeDefined();
    expect(ctx.notifications.resources).toBeDefined();
    expect(ctx.notifications.prompts).toBeDefined();
  });
});
