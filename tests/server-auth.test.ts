import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ToolCatalog } from "../src/catalog.js";
import { ArcadeMCPServer } from "../src/server.js";
import type { MCPSettings } from "../src/settings.js";
import type { MaterializedTool } from "../src/types.js";

const mockAuthorize = vi.fn();

vi.mock("@arcadeai/arcadejs", () => {
  class MockArcade {
    auth = { authorize: mockAuthorize };
    constructor(_opts: unknown) {}
  }
  return { default: MockArcade };
});

function makeSettings(
  overrides: Partial<MCPSettings["arcade"]> = {},
): MCPSettings {
  return {
    debug: false,
    notification: {
      rateLimitPerMinute: 60,
      defaultDebounceMs: 100,
      maxQueuedNotifications: 1000,
    },
    transport: {
      sessionTimeoutSeconds: 300,
      cleanupIntervalSeconds: 10,
      maxSessions: 1000,
      maxQueueSize: 1000,
    },
    server: { name: "test", version: "0.0.1" },
    resourceServer: {},
    middleware: {
      enableLogging: false,
      logLevel: "ERROR",
      enableErrorHandling: false,
      maskErrorDetails: false,
    },
    telemetry: { enable: false, serviceName: "test" },
    arcade: {
      apiKey: "test-api-key",
      apiUrl: "https://api.arcade.dev",
      authDisabled: false,
      environment: "dev",
      userId: "test-user",
      ...overrides,
    },
    toolSecrets: {},
  };
}

function makeAuthTool(): MaterializedTool {
  return {
    name: "star_repo",
    fullyQualifiedName: "github.star_repo",
    description: "Star a repo",
    handler: async (_args, ctx) => {
      return { token: ctx.getAuthToken() };
    },
    parameters: z.object({ repo: z.string() }),
    auth: {
      providerId: "github",
      providerType: "oauth2",
      scopes: ["repo"],
    },
    dateAdded: new Date(),
    dateUpdated: new Date(),
  };
}

function makeNoAuthTool(): MaterializedTool {
  return {
    name: "echo",
    fullyQualifiedName: "echo",
    description: "Echo input",
    handler: async (args) => args,
    parameters: z.object({ message: z.string() }),
    dateAdded: new Date(),
    dateUpdated: new Date(),
  };
}

function makeExtra() {
  return {
    signal: new AbortController().signal,
    requestId: "test-req",
    sendNotification: async () => {},
    sendRequest: async () => ({}),
  } as never;
}

function makeServer(arcadeOverrides: Partial<MCPSettings["arcade"]> = {}) {
  const catalog = new ToolCatalog();
  return new ArcadeMCPServer(catalog, {
    name: "test",
    version: "0.0.1",
    settings: makeSettings(arcadeOverrides),
  });
}

// biome-ignore lint/suspicious/noExplicitAny: accessing private method for testing
type AnyServer = any;

describe("ArcadeMCPServer auth resolution", () => {
  beforeEach(() => {
    mockAuthorize.mockReset();
  });

  it("resolves auth token when status is completed", async () => {
    mockAuthorize.mockResolvedValue({
      status: "completed",
      context: { token: "ghp_test123" },
    });

    const server = makeServer();
    const tool = makeAuthTool();

    const result = await (server as AnyServer).executeTool(
      tool,
      { repo: "test" },
      makeExtra(),
    );

    expect(mockAuthorize).toHaveBeenCalledOnce();
    expect(mockAuthorize).toHaveBeenCalledWith({
      user_id: "test-user",
      auth_requirement: {
        provider_id: "github",
        provider_type: "oauth2",
        oauth2: { scopes: ["repo"] },
      },
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("ghp_test123");
  });

  it("returns auth URL when status is pending", async () => {
    mockAuthorize.mockResolvedValue({
      status: "pending",
      url: "https://arcade.dev/auth/github/abc123",
    });

    const server = makeServer();
    const result = await (server as AnyServer).executeTool(
      makeAuthTool(),
      { repo: "test" },
      makeExtra(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(
      "https://arcade.dev/auth/github/abc123",
    );
  });

  it("returns auth URL when status is not_started", async () => {
    mockAuthorize.mockResolvedValue({
      status: "not_started",
      url: "https://arcade.dev/auth/github/abc123",
    });

    const server = makeServer();
    const result = await (server as AnyServer).executeTool(
      makeAuthTool(),
      { repo: "test" },
      makeExtra(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Authorization required");
  });

  it("returns error when status is failed", async () => {
    mockAuthorize.mockResolvedValue({ status: "failed" });

    const server = makeServer();
    const result = await (server as AnyServer).executeTool(
      makeAuthTool(),
      { repo: "test" },
      makeExtra(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Authorization failed");
  });

  it("skips auth resolution for tools without auth", async () => {
    const server = makeServer();
    const result = await (server as AnyServer).executeTool(
      makeNoAuthTool(),
      { message: "hello" },
      makeExtra(),
    );

    expect(mockAuthorize).not.toHaveBeenCalled();
    expect(result.isError).toBeUndefined();
  });

  it("skips auth resolution when authDisabled is true", async () => {
    const server = makeServer({ authDisabled: true });
    const result = await (server as AnyServer).executeTool(
      makeAuthTool(),
      { repo: "test" },
      makeExtra(),
    );

    expect(mockAuthorize).not.toHaveBeenCalled();
    // Tool runs but getAuthToken() will throw — that's expected
    expect(result.isError).toBe(true);
  });

  it("skips auth resolution when no API key is configured", async () => {
    const server = makeServer({ apiKey: undefined });
    const result = await (server as AnyServer).executeTool(
      makeAuthTool(),
      { repo: "test" },
      makeExtra(),
    );

    expect(mockAuthorize).not.toHaveBeenCalled();
  });

  it("returns error when no user ID is available", async () => {
    const server = makeServer({ userId: undefined });
    const result = await (server as AnyServer).executeTool(
      makeAuthTool(),
      { repo: "test" },
      makeExtra(),
    );

    expect(mockAuthorize).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("ARCADE_USER_ID");
  });
});
