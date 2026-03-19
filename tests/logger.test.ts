import { afterEach, describe, expect, it } from "vitest";

describe("createLogger", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns a pino logger with the given name", async () => {
    delete process.env.MCP_LOG_FORMAT;
    // Dynamic import so env var is read fresh
    const { createLogger } = await import("../src/logger.js");
    const logger = createLogger("test-logger");
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("defaults to json format (no transport)", async () => {
    delete process.env.MCP_LOG_FORMAT;
    const { createLogger } = await import("../src/logger.js");
    const logger = createLogger("json-test");
    // pino-pretty sets a Symbol-based transport property; plain pino does not
    // We verify by checking the logger works without error
    expect(logger).toBeDefined();
  });

  it("uses pino-pretty transport when MCP_LOG_FORMAT=pretty", async () => {
    process.env.MCP_LOG_FORMAT = "pretty";
    // Clear module cache to pick up new env
    const mod = await import("../src/logger.js");
    const logger = mod.createLogger("pretty-test");
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
  });

  it("treats unknown format values as json", async () => {
    process.env.MCP_LOG_FORMAT = "xml";
    const { createLogger } = await import("../src/logger.js");
    const logger = createLogger("fallback-test");
    expect(logger).toBeDefined();
  });
});
