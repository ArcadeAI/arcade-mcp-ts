import { z } from "zod";
import {
  type CallNext,
  ErrorHandlingMiddleware,
  LoggingMiddleware,
  MCPApp,
  Middleware,
  type MiddlewareContext,
  RetryableToolError,
} from "../../src/index.js";

// ── Custom Middleware: Timing ───────────────────────────────

class TimingMiddleware extends Middleware {
  async onCallTool(
    context: MiddlewareContext,
    next: CallNext,
  ): Promise<unknown> {
    const start = performance.now();
    const result = await next(context);
    const elapsed = (performance.now() - start).toFixed(2);
    console.log(
      `[timing] ${context.params?.name ?? "unknown"} took ${elapsed}ms`,
    );
    return result;
  }
}

// ── Custom Middleware: Rate Limiting ────────────────────────

class RateLimitMiddleware extends Middleware {
  private callCounts = new Map<string, number>();
  private maxCalls: number;

  constructor(maxCallsPerTool = 10) {
    super();
    this.maxCalls = maxCallsPerTool;
  }

  async onCallTool(
    context: MiddlewareContext,
    next: CallNext,
  ): Promise<unknown> {
    const toolName = (context.params as { name?: string })?.name ?? "unknown";
    const count = (this.callCounts.get(toolName) ?? 0) + 1;
    this.callCounts.set(toolName, count);

    if (count > this.maxCalls) {
      throw new RetryableToolError(
        `Rate limit exceeded for ${toolName} (max ${this.maxCalls} calls)`,
        { retryAfterMs: 5_000 },
      );
    }

    return next(context);
  }
}

// ── App with Middleware Composition ─────────────────────────

const app = new MCPApp({
  name: "MathServer",
  version: "1.0.0",
  instructions:
    "Math tools with custom middleware for timing and rate limiting",
  middleware: [
    new ErrorHandlingMiddleware(),
    new LoggingMiddleware(),
    new TimingMiddleware(),
    new RateLimitMiddleware(5), // Max 5 calls per tool
  ],
});

app.tool(
  "add",
  {
    description: "Add two numbers",
    parameters: z.object({
      a: z.number().describe("First number"),
      b: z.number().describe("Second number"),
    }),
  },
  async (args) => ({ result: args.a + args.b }),
);

app.tool(
  "multiply",
  {
    description: "Multiply two numbers",
    parameters: z.object({
      a: z.number().describe("First number"),
      b: z.number().describe("Second number"),
    }),
  },
  async (args) => ({ result: args.a * args.b }),
);

app.tool(
  "divide",
  {
    description: "Divide two numbers",
    parameters: z.object({
      a: z.number().describe("Numerator"),
      b: z.number().describe("Denominator"),
    }),
  },
  async (args) => {
    if (args.b === 0) {
      throw new Error("Division by zero");
    }
    return { result: args.a / args.b };
  },
);

app.run();
