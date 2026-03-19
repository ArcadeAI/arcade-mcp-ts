import { describe, expect, it } from "vitest";
import { ErrorHandlingMiddleware } from "../../src/middleware/error-handling.js";
import type { MiddlewareContext } from "../../src/types.js";

function makeContext(method = "tools/call"): MiddlewareContext {
  return {
    method,
    params: {},
    source: "client",
    type: "request",
    timestamp: new Date(),
    requestId: "req-1",
    metadata: {},
  };
}

describe("ErrorHandlingMiddleware", () => {
  it("passes through on success", async () => {
    const mw = new ErrorHandlingMiddleware();
    const result = await mw.handle(makeContext(), async () => "ok");
    expect(result).toBe("ok");
  });

  it("catches errors in onCallTool and returns error result", async () => {
    const mw = new ErrorHandlingMiddleware();
    const ctx = makeContext("tools/call");

    const result = (await mw.handle(ctx, async () => {
      throw new Error("tool broke");
    })) as { isError: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("tool broke");
  });

  it("masks error details when configured", async () => {
    const mw = new ErrorHandlingMiddleware(true);
    const ctx = makeContext("tools/call");

    const result = (await mw.handle(ctx, async () => {
      throw new Error("sensitive details here");
    })) as { isError: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Internal server error");
  });

  it("returns -32602 for TypeError", async () => {
    const mw = new ErrorHandlingMiddleware();
    const ctx = makeContext("ping");

    const result = (await mw.handle(ctx, async () => {
      throw new TypeError("bad type");
    })) as { error: { code: number; message: string } };

    expect(result.error.code).toBe(-32602);
  });

  it("returns -32603 for unknown errors", async () => {
    const mw = new ErrorHandlingMiddleware();
    const ctx = makeContext("ping");

    const result = (await mw.handle(ctx, async () => {
      throw new Error("something");
    })) as { error: { code: number; message: string } };

    expect(result.error.code).toBe(-32603);
  });
});
