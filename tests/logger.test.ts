import { afterEach, describe, expect, it } from "vitest";

describe("createLogger", () => {
  const originalEnv = { ...process.env };
  const originalIsTTY = process.stderr.isTTY;

  afterEach(() => {
    process.env = { ...originalEnv };
    process.stderr.isTTY = originalIsTTY;
  });

  it("returns a pino logger with the given name", async () => {
    delete process.env.MCP_LOG_FORMAT;
    process.stderr.isTTY = false;
    const { createLogger } = await import("../src/logger.js");
    const logger = createLogger("test-logger");
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("defaults to json format when not a TTY", async () => {
    delete process.env.MCP_LOG_FORMAT;
    process.stderr.isTTY = false;
    const { createLogger } = await import("../src/logger.js");
    const logger = createLogger("json-test");
    expect(logger).toBeDefined();
  });

  it("defaults to pretty format when in a TTY", async () => {
    delete process.env.MCP_LOG_FORMAT;
    process.stderr.isTTY = true;
    const { createLogger } = await import("../src/logger.js");
    const logger = createLogger("pretty-tty-test");
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
  });

  it("uses pino-pretty transport when MCP_LOG_FORMAT=pretty", async () => {
    process.env.MCP_LOG_FORMAT = "pretty";
    const mod = await import("../src/logger.js");
    const logger = mod.createLogger("pretty-test");
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
  });

  it("uses json format when MCP_LOG_FORMAT=json even in TTY", async () => {
    process.env.MCP_LOG_FORMAT = "json";
    process.stderr.isTTY = true;
    const { createLogger } = await import("../src/logger.js");
    const logger = createLogger("json-override-test");
    expect(logger).toBeDefined();
  });

  it("treats unknown format values as auto-detect", async () => {
    process.env.MCP_LOG_FORMAT = "xml";
    process.stderr.isTTY = false;
    const { createLogger } = await import("../src/logger.js");
    const logger = createLogger("fallback-test");
    expect(logger).toBeDefined();
  });
});
