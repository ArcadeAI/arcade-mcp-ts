import { afterEach, describe, expect, it } from "vitest";
import { loadSettings } from "../src/settings.js";

describe("loadSettings", () => {
	const originalEnv = { ...process.env };

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("returns defaults", () => {
		const settings = loadSettings();
		expect(settings.server.name).toBe("ArcadeMCP");
		expect(settings.server.version).toBe("0.1.0");
		expect(settings.arcade.apiUrl).toBe("https://api.arcade.dev");
		expect(settings.arcade.authDisabled).toBe(false);
		expect(settings.middleware.enableLogging).toBe(true);
		expect(settings.middleware.enableErrorHandling).toBe(true);
		expect(settings.transport.sessionTimeoutSeconds).toBe(300);
		expect(settings.debug).toBe(false);
		expect(settings.telemetry.enable).toBe(false);
		expect(settings.telemetry.serviceName).toBe("arcade-mcp-worker");
	});

	it("reads env overrides", () => {
		process.env.MCP_SERVER_NAME = "CustomServer";
		process.env.MCP_SERVER_VERSION = "2.0.0";
		process.env.ARCADE_API_KEY = "my-key";
		process.env.MCP_DEBUG = "true";

		const settings = loadSettings();
		expect(settings.server.name).toBe("CustomServer");
		expect(settings.server.version).toBe("2.0.0");
		expect(settings.arcade.apiKey).toBe("my-key");
		expect(settings.debug).toBe(true);
	});

	it("collects tool secrets from non-prefixed env vars", () => {
		process.env.GITHUB_TOKEN = "gh-token";
		process.env.SLACK_TOKEN = "slack-token";

		const settings = loadSettings();
		expect(settings.toolSecrets.GITHUB_TOKEN).toBe("gh-token");
		expect(settings.toolSecrets.SLACK_TOKEN).toBe("slack-token");
	});

	it("excludes MCP_ and _ prefixed vars from secrets", () => {
		process.env.MCP_SERVER_NAME = "Test";
		process.env._INTERNAL = "hidden";

		const settings = loadSettings();
		expect(settings.toolSecrets.MCP_SERVER_NAME).toBeUndefined();
		expect(settings.toolSecrets._INTERNAL).toBeUndefined();
	});

	it("parses authorization servers from JSON", () => {
		process.env.MCP_RESOURCE_SERVER_AUTHORIZATION_SERVERS = JSON.stringify([
			{
				url: "https://auth.example.com",
				issuer: "https://auth.example.com",
				jwksUri: "https://auth.example.com/.well-known/jwks.json",
			},
		]);

		const settings = loadSettings();
		expect(settings.resourceServer.authorizationServers).toHaveLength(1);
		expect(settings.resourceServer.authorizationServers![0].issuer).toBe(
			"https://auth.example.com",
		);
	});

	it("handles invalid JSON for authorization servers", () => {
		process.env.MCP_RESOURCE_SERVER_AUTHORIZATION_SERVERS = "not-json";

		const settings = loadSettings();
		expect(settings.resourceServer.authorizationServers).toBeUndefined();
	});

	it("reads ARCADE_WORKER_SECRET", () => {
		process.env.ARCADE_WORKER_SECRET = "worker-secret";

		const settings = loadSettings();
		expect(settings.arcade.serverSecret).toBe("worker-secret");
	});

	it("reads telemetry settings from env", () => {
		process.env.ARCADE_MCP_OTEL_ENABLE = "true";
		process.env.OTEL_SERVICE_NAME = "my-service";

		const settings = loadSettings();
		expect(settings.telemetry.enable).toBe(true);
		expect(settings.telemetry.serviceName).toBe("my-service");
	});
});
