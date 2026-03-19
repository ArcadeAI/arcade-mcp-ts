import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock posthog-node before importing ServerTracker
const mockCapture = vi.fn();
const mockAlias = vi.fn();
const mockShutdown = vi.fn().mockResolvedValue(undefined);

vi.mock("posthog-node", () => ({
  PostHog: vi.fn().mockImplementation(() => ({
    capture: mockCapture,
    alias: mockAlias,
    shutdown: mockShutdown,
  })),
}));

import { ServerTracker } from "../../src/usage/server-tracker.js";

describe("ServerTracker", () => {
  let testDir: string;
  const originalTracking = process.env.ARCADE_USAGE_TRACKING;

  beforeEach(() => {
    testDir = join(tmpdir(), `arcade-tracker-test-${Date.now()}`);
    mkdirSync(join(testDir, ".arcade"), { recursive: true });
    process.env.ARCADE_WORK_DIR = testDir;
    delete process.env.ARCADE_USAGE_TRACKING;
    mockCapture.mockClear();
    mockAlias.mockClear();
    mockShutdown.mockClear();
  });

  afterEach(() => {
    delete process.env.ARCADE_WORK_DIR;
    rmSync(testDir, { recursive: true, force: true });
    if (originalTracking === undefined) {
      delete process.env.ARCADE_USAGE_TRACKING;
    } else {
      process.env.ARCADE_USAGE_TRACKING = originalTracking;
    }
  });

  describe("when tracking is enabled", () => {
    it("trackServerStart captures event with correct properties", () => {
      const tracker = new ServerTracker("1.0.0");
      tracker.trackServerStart({
        transport: "http",
        host: "127.0.0.1",
        port: 8000,
        toolCount: 5,
        resourceServerType: "jwt",
      });

      expect(mockCapture).toHaveBeenCalledTimes(1);
      const call = mockCapture.mock.calls[0][0];
      expect(call.event).toBe("mcp_server_started");
      expect(call.properties.transport).toBe("http");
      expect(call.properties.tool_count).toBe(5);
      expect(call.properties.resource_server_type).toBe("jwt");
      expect(call.properties.mcp_server_version).toBe("1.0.0");
      expect(call.properties.runtime_language).toBe("typescript");
      expect(call.properties.host).toBe("127.0.0.1");
      expect(call.properties.port).toBe(8000);
      expect(call.properties.os_type).toBeDefined();
      expect(call.properties.os_release).toBeDefined();
      expect(call.properties.device_timestamp).toBeDefined();
    });

    it("trackServerStart omits host/port for stdio", () => {
      const tracker = new ServerTracker("1.0.0");
      tracker.trackServerStart({
        transport: "stdio",
        toolCount: 3,
      });

      expect(mockCapture).toHaveBeenCalledTimes(1);
      const props = mockCapture.mock.calls[0][0].properties;
      expect(props.transport).toBe("stdio");
      expect(props.host).toBeUndefined();
      expect(props.port).toBeUndefined();
    });

    it("trackToolCall captures success event", () => {
      const tracker = new ServerTracker("1.0.0");
      tracker.trackToolCall({ success: true });

      expect(mockCapture).toHaveBeenCalledTimes(1);
      const call = mockCapture.mock.calls[0][0];
      expect(call.event).toBe("mcp_tool_called");
      expect(call.properties.is_execution_success).toBe(true);
      expect(call.properties.failure_reason).toBeUndefined();
    });

    it("trackToolCall captures failure event with reason", () => {
      const tracker = new ServerTracker("1.0.0");
      tracker.trackToolCall({
        success: false,
        failureReason: "error during tool execution",
      });

      expect(mockCapture).toHaveBeenCalledTimes(1);
      const call = mockCapture.mock.calls[0][0];
      expect(call.event).toBe("mcp_tool_called");
      expect(call.properties.is_execution_success).toBe(false);
      expect(call.properties.failure_reason).toBe(
        "error during tool execution",
      );
    });

    it("shutdown flushes the PostHog client", async () => {
      const tracker = new ServerTracker("1.0.0");
      await tracker.shutdown();
      expect(mockShutdown).toHaveBeenCalledTimes(1);
    });
  });

  describe("when tracking is disabled", () => {
    it("does not capture any events", () => {
      process.env.ARCADE_USAGE_TRACKING = "0";
      const tracker = new ServerTracker("1.0.0");

      tracker.trackServerStart({
        transport: "stdio",
        toolCount: 3,
      });
      tracker.trackToolCall({ success: true });

      expect(mockCapture).not.toHaveBeenCalled();
    });

    it("shutdown is a no-op", async () => {
      process.env.ARCADE_USAGE_TRACKING = "0";
      const tracker = new ServerTracker("1.0.0");
      await tracker.shutdown();
      expect(mockShutdown).not.toHaveBeenCalled();
    });
  });
});
