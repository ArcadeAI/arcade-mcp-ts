import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Context } from "../src/context.js";
import {
  FatalToolError,
  RetryableToolError,
  ToolInputError,
} from "../src/errors.js";
import { handleToolError, runTool } from "../src/executor.js";
import type { MaterializedTool } from "../src/types.js";

function makeContext(): Context {
  return new Context(
    {
      signal: new AbortController().signal,
      requestId: "test-req",
      sendNotification: async () => {},
      sendRequest: async () => ({}),
    } as never,
    {
      requestId: "test-req",
      toolContext: { secrets: { MY_KEY: "secret123" }, metadata: {} },
    },
  );
}

function makeTool(
  // biome-ignore lint/suspicious/noExplicitAny: test helper
  handler: (args: any, ctx: any) => any,
  parameters?: z.ZodType,
): MaterializedTool {
  return {
    name: "test_tool",
    fullyQualifiedName: "test_tool",
    description: "A test tool",
    handler,
    parameters: parameters ?? z.object({ message: z.string() }),
    dateAdded: new Date(),
    dateUpdated: new Date(),
  };
}

describe("runTool", () => {
  it("succeeds with valid input", async () => {
    const tool = makeTool(async (args) => args.message);
    const ctx = makeContext();

    const result = await runTool(tool, { message: "hello" }, ctx);
    expect(result.success).toBe(true);
    expect(result.value).toBe("hello");
  });

  it("returns validation error for invalid input", async () => {
    const tool = makeTool(async (args) => args.message);
    const ctx = makeContext();

    const result = await runTool(tool, { message: 42 }, ctx);
    expect(result.success).toBe(false);
    expect(result.error?.kind).toBe("tool_runtime_bad_input_value");
  });

  it("returns error for missing required field", async () => {
    const tool = makeTool(async (args) => args.message);
    const ctx = makeContext();

    const result = await runTool(tool, {}, ctx);
    expect(result.success).toBe(false);
    expect(result.error?.kind).toBe("tool_runtime_bad_input_value");
  });

  it("handles RetryableToolError", async () => {
    const tool = makeTool(async () => {
      throw new RetryableToolError("try again", { retryAfterMs: 1000 });
    });
    const ctx = makeContext();

    const result = await runTool(tool, { message: "hello" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error?.canRetry).toBe(true);
    expect(result.error?.retryAfterMs).toBe(1000);
  });

  it("handles FatalToolError", async () => {
    const tool = makeTool(async () => {
      throw new FatalToolError("kaboom");
    });
    const ctx = makeContext();

    const result = await runTool(tool, { message: "hello" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error?.kind).toBe("tool_runtime_fatal");
    expect(result.error?.canRetry).toBe(false);
  });

  it("handles unknown errors", async () => {
    const tool = makeTool(async () => {
      throw new Error("surprise!");
    });
    const ctx = makeContext();

    const result = await runTool(tool, { message: "hello" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error?.message).toBe("surprise!");
    expect(result.error?.kind).toBe("tool_runtime_fatal");
  });

  it("passes context to handler", async () => {
    const tool = makeTool(async (_args, ctx) => {
      return ctx.getSecret("MY_KEY");
    });
    const ctx = makeContext();

    const result = await runTool(tool, { message: "hello" }, ctx);
    expect(result.success).toBe(true);
    expect(result.value).toBe("secret123");
  });

  it("handles complex return types", async () => {
    const tool = makeTool(async () => {
      return { starred: true, repo: "owner/repo" };
    });
    const ctx = makeContext();

    const result = await runTool(tool, { message: "hello" }, ctx);
    expect(result.success).toBe(true);
    expect(result.value).toEqual({ starred: true, repo: "owner/repo" });
  });
});

describe("handleToolError", () => {
  it("handles ToolkitError subclasses", () => {
    const result = handleToolError(new ToolInputError("bad input"));
    expect(result.success).toBe(false);
    expect(result.error?.kind).toBe("tool_runtime_bad_input_value");
  });

  it("handles plain errors", () => {
    const result = handleToolError(new Error("oops"));
    expect(result.success).toBe(false);
    expect(result.error?.message).toBe("oops");
  });

  it("handles non-error values", () => {
    const result = handleToolError("string error");
    expect(result.success).toBe(false);
    expect(result.error?.message).toBe("string error");
  });
});
