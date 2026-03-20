import type { Logger } from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoggingMiddleware } from "../../src/middleware/logging.js";
import { makeMiddlewareContext } from "../helpers.js";

function createMockLogger() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
  } as unknown as Logger & {
    info: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
}

describe("LoggingMiddleware", () => {
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
  });

  it("emits a single info line on success", async () => {
    const mw = new LoggingMiddleware("INFO", mockLogger);
    const ctx = makeMiddlewareContext({
      requestId: "req-42",
      sessionId: "sess-1",
    });

    await mw.handle(ctx, async () => "ok");

    expect(mockLogger.info).toHaveBeenCalledTimes(1);
    const [meta, msg] = mockLogger.info.mock.calls[0];
    expect(meta.method).toBe("tools/call");
    expect(meta.requestId).toBe("req-42");
    expect(meta.sessionId).toBe("sess-1");
    expect(meta.elapsed).toMatch(/^\d+\.\d+ms$/);
    expect(msg).toContain("tools/call");
    expect(msg).toContain("ms");
  });

  it("emits a single error line on failure", async () => {
    const mw = new LoggingMiddleware("INFO", mockLogger);
    const ctx = makeMiddlewareContext({ requestId: "req-99" });

    await expect(
      mw.handle(ctx, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    const [meta, msg] = mockLogger.error.mock.calls[0];
    expect(meta.method).toBe("tools/call");
    expect(meta.requestId).toBe("req-99");
    expect(meta.error).toContain("Error: boom");
    expect(meta.elapsed).toMatch(/^\d+\.\d+ms$/);
    expect(msg).toContain("tools/call");
  });

  it("uses debug level when configured", async () => {
    const mw = new LoggingMiddleware("DEBUG", mockLogger);
    const ctx = makeMiddlewareContext();

    await mw.handle(ctx, async () => "ok");

    expect(mockLogger.debug).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).not.toHaveBeenCalled();
  });

  it("passes through the handler result", async () => {
    const mw = new LoggingMiddleware("INFO", mockLogger);
    const ctx = makeMiddlewareContext();

    const result = await mw.handle(ctx, async () => ({ data: 42 }));

    expect(result).toEqual({ data: 42 });
  });

  it("does not log before the handler completes", async () => {
    const mw = new LoggingMiddleware("INFO", mockLogger);
    const ctx = makeMiddlewareContext();

    await mw.handle(ctx, async () => {
      expect(mockLogger.info).not.toHaveBeenCalled();
      return "ok";
    });

    expect(mockLogger.info).toHaveBeenCalledTimes(1);
  });
});
