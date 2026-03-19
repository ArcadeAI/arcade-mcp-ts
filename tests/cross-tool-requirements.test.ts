import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ToolCatalog } from "../src/catalog.js";
import { ArcadeMCPServer } from "../src/server.js";
import { loadSettings } from "../src/settings.js";
import type { ToolOptions } from "../src/types.js";

// ── Mock Arcade client ──────────────────────────────────────

const mockToolsGet = vi.fn();

vi.mock("@arcadeai/arcadejs", () => {
	class MockArcade {
		auth = { authorize: vi.fn() };
		tools = { get: mockToolsGet };
	}
	return { default: MockArcade };
});

// ── Helpers ─────────────────────────────────────────────────

function makeSettings(arcadeOverrides?: Record<string, unknown>) {
	const settings = loadSettings();
	return {
		...settings,
		arcade: {
			...settings.arcade,
			apiKey: "test-key",
			apiUrl: "https://api.arcade.dev",
			...arcadeOverrides,
		},
	};
}

function makeServer(catalog: ToolCatalog): ArcadeMCPServer {
	return new ArcadeMCPServer(catalog, {
		name: "test",
		version: "1.0.0",
		settings: makeSettings(),
	});
}

function addToolToCatalog(
	catalog: ToolCatalog,
	name: string,
	opts: Partial<ToolOptions> & {
		requiresSecretsFrom?: string[];
		requestScopesFrom?: string[];
		auth?: ToolOptions["auth"];
		secrets?: string[];
	},
): void {
	catalog.addTool(
		name,
		{
			description: opts.description ?? "test tool",
			parameters: z.object({}),
			auth: opts.auth,
			secrets: opts.secrets,
			requiresSecretsFrom: opts.requiresSecretsFrom,
			requestScopesFrom: opts.requestScopesFrom,
		},
		vi.fn(async () => "result"),
		{ name: "TestKit" },
	);
}

// ── Tests ───────────────────────────────────────────────────

describe("resolveCrossToolRequirements", () => {
	beforeEach(() => {
		mockToolsGet.mockReset();
	});

	it("does nothing when no tools have cross-tool requirements", async () => {
		const catalog = new ToolCatalog();
		addToolToCatalog(catalog, "simple", {});

		const server = makeServer(catalog);
		await server.resolveCrossToolRequirements();

		expect(mockToolsGet).not.toHaveBeenCalled();
	});

	it("merges secrets from remote tool via requiresSecretsFrom", async () => {
		const catalog = new ToolCatalog();
		addToolToCatalog(catalog, "compound", {
			requiresSecretsFrom: ["Gmail.ListEmails"],
			secrets: ["EXISTING_SECRET"],
		});

		mockToolsGet.mockResolvedValue({
			requirements: {
				secrets: [{ key: "GMAIL_API_KEY" }, { key: "GMAIL_CLIENT_ID" }],
			},
		});

		const server = makeServer(catalog);
		await server.resolveCrossToolRequirements();

		expect(mockToolsGet).toHaveBeenCalledWith("Gmail.ListEmails");
		const tool = catalog.getTool("TestKit_compound")!;
		expect(tool.secrets).toContain("EXISTING_SECRET");
		expect(tool.secrets).toContain("GMAIL_API_KEY");
		expect(tool.secrets).toContain("GMAIL_CLIENT_ID");
	});

	it("does not duplicate existing secrets", async () => {
		const catalog = new ToolCatalog();
		addToolToCatalog(catalog, "compound", {
			requiresSecretsFrom: ["Gmail.ListEmails"],
			secrets: ["GMAIL_API_KEY"],
		});

		mockToolsGet.mockResolvedValue({
			requirements: {
				secrets: [{ key: "GMAIL_API_KEY" }],
			},
		});

		const server = makeServer(catalog);
		await server.resolveCrossToolRequirements();

		const tool = catalog.getTool("TestKit_compound")!;
		expect(tool.secrets!.filter((s) => s === "GMAIL_API_KEY")).toHaveLength(1);
	});

	it("merges auth scopes from remote tool via requestScopesFrom", async () => {
		const catalog = new ToolCatalog();
		addToolToCatalog(catalog, "compound", {
			requestScopesFrom: ["Gmail.ListEmails"],
		});

		mockToolsGet.mockResolvedValue({
			requirements: {
				authorization: {
					provider_id: "google",
					provider_type: "oauth2",
					oauth2: {
						scopes: ["gmail.readonly", "gmail.send"],
					},
				},
			},
		});

		const server = makeServer(catalog);
		await server.resolveCrossToolRequirements();

		const tool = catalog.getTool("TestKit_compound")!;
		expect(tool.auth).toBeDefined();
		expect(tool.auth!.providerId).toBe("google");
		expect(tool.auth!.scopes).toContain("gmail.readonly");
		expect(tool.auth!.scopes).toContain("gmail.send");
	});

	it("creates multi-provider resolvedAuthorizations for different providers", async () => {
		const catalog = new ToolCatalog();
		addToolToCatalog(catalog, "compound", {
			auth: {
				providerId: "google",
				providerType: "oauth2",
				scopes: ["gmail.readonly"],
			},
			requestScopesFrom: ["Slack.SendMessage"],
		});

		mockToolsGet.mockResolvedValue({
			requirements: {
				authorization: {
					provider_id: "slack",
					provider_type: "oauth2",
					oauth2: {
						scopes: ["chat:write"],
					},
				},
			},
		});

		const server = makeServer(catalog);
		await server.resolveCrossToolRequirements();

		const tool = catalog.getTool("TestKit_compound")!;
		expect(tool.resolvedAuthorizations).toBeDefined();
		expect(tool.resolvedAuthorizations).toHaveLength(2);
		expect(tool.resolvedAuthorizations![0].providerId).toBe("google");
		expect(tool.resolvedAuthorizations![1].providerId).toBe("slack");
		expect(tool.resolvedAuthorizations![1].scopes).toContain("chat:write");
	});

	it("merges scopes into same provider", async () => {
		const catalog = new ToolCatalog();
		addToolToCatalog(catalog, "compound", {
			auth: {
				providerId: "google",
				providerType: "oauth2",
				scopes: ["gmail.readonly"],
			},
			requestScopesFrom: ["Google.Calendar"],
		});

		mockToolsGet.mockResolvedValue({
			requirements: {
				authorization: {
					provider_id: "google",
					provider_type: "oauth2",
					oauth2: {
						scopes: ["calendar.events"],
					},
				},
			},
		});

		const server = makeServer(catalog);
		await server.resolveCrossToolRequirements();

		const tool = catalog.getTool("TestKit_compound")!;
		// Same provider — should merge, not create multi-provider
		expect(tool.resolvedAuthorizations).toBeUndefined();
		expect(tool.auth!.providerId).toBe("google");
		expect(tool.auth!.scopes).toContain("gmail.readonly");
		expect(tool.auth!.scopes).toContain("calendar.events");
	});

	it("warns when no Arcade client and tools need resolution", async () => {
		const catalog = new ToolCatalog();
		addToolToCatalog(catalog, "compound", {
			requiresSecretsFrom: ["Gmail.ListEmails"],
		});

		const server = new ArcadeMCPServer(catalog, {
			name: "test",
			version: "1.0.0",
			settings: makeSettings({ apiKey: undefined }),
		});

		// Should not throw
		await server.resolveCrossToolRequirements();

		// Secrets should not have been merged
		const tool = catalog.getTool("TestKit_compound")!;
		expect(tool.secrets).toBeUndefined();
	});

	it("handles failed remote tool fetch gracefully", async () => {
		const catalog = new ToolCatalog();
		addToolToCatalog(catalog, "compound", {
			requiresSecretsFrom: ["NonExistent.Tool"],
		});

		mockToolsGet.mockRejectedValue(new Error("Not found"));

		const server = makeServer(catalog);
		// Should not throw
		await server.resolveCrossToolRequirements();

		const tool = catalog.getTool("TestKit_compound")!;
		expect(tool.secrets).toBeUndefined();
	});
});
