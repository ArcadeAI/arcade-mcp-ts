import { Context } from "../src/context.js";
import type { MiddlewareContext } from "../src/types.js";

/**
 * Create a mock MCP "extra" object for Context construction.
 */
export function makeExtra(overrides?: Record<string, unknown>) {
  return {
    signal: new AbortController().signal,
    requestId: "test-req",
    sendNotification: async () => {},
    sendRequest: async () => ({}),
    ...overrides,
  } as never;
}

/**
 * Create a Context instance with default secrets for tool execution tests.
 */
export function makeTestContext(toolContext?: {
  secrets?: Record<string, string>;
  metadata?: Record<string, unknown>;
  authToken?: string;
  userId?: string;
}): Context {
  return new Context(makeExtra(), {
    requestId: "test-req",
    toolContext: toolContext ?? {
      secrets: { MY_KEY: "secret123" },
      metadata: {},
    },
  });
}

/**
 * Create a MiddlewareContext with sensible defaults.
 */
export function makeMiddlewareContext(
  overrides?: Partial<MiddlewareContext>,
): MiddlewareContext {
  return {
    method: "tools/call",
    params: {},
    source: "client",
    type: "request",
    timestamp: new Date(),
    requestId: "req-1",
    metadata: {},
    ...overrides,
  };
}

/**
 * Snapshot process.env for save/restore in tests.
 * Usage:
 *   const { restore } = withCleanEnv();
 *   afterEach(() => restore());
 */
export function withCleanEnv() {
  const originalEnv = { ...process.env };
  return {
    originalEnv,
    restore() {
      process.env = { ...originalEnv };
    },
  };
}
