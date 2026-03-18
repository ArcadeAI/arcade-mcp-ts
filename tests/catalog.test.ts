import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
	normalizeVersion,
	ToolCatalog,
	toToolDefinition,
} from "../src/catalog.js";
import { ToolDefinitionError } from "../src/errors.js";

describe("ToolCatalog", () => {
	let catalog: ToolCatalog;

	beforeEach(() => {
		catalog = new ToolCatalog();
	});

	it("starts empty", () => {
		expect(catalog.isEmpty).toBe(true);
		expect(catalog.size).toBe(0);
	});

	it("adds a tool", () => {
		catalog.addTool(
			"echo",
			{
				description: "Echo a message",
				parameters: z.object({ message: z.string() }),
			},
			async (args) => args.message,
		);

		expect(catalog.size).toBe(1);
		expect(catalog.has("echo")).toBe(true);
		expect(catalog.isEmpty).toBe(false);
	});

	it("adds a tool with toolkit name", () => {
		catalog.addTool(
			"echo",
			{
				description: "Echo",
				parameters: z.object({ message: z.string() }),
			},
			async (args) => args.message,
			{ name: "MyToolkit" },
		);

		expect(catalog.has("MyToolkit_echo")).toBe(true);
		expect(catalog.has("echo")).toBe(true);
	});

	it("throws on duplicate tool names", () => {
		const opts = {
			description: "Test",
			parameters: z.object({}),
		};
		const handler = async () => {};

		catalog.addTool("echo", opts, handler);
		expect(() => catalog.addTool("echo", opts, handler)).toThrow(
			ToolDefinitionError,
		);
	});

	it("gets tool by fully-qualified name", () => {
		catalog.addTool(
			"echo",
			{
				description: "Echo",
				parameters: z.object({ msg: z.string() }),
			},
			async (args) => args.msg,
			{ name: "Tools" },
		);

		const tool = catalog.getTool("Tools_echo");
		expect(tool).toBeDefined();
		expect(tool!.name).toBe("echo");
		expect(tool!.fullyQualifiedName).toBe("Tools_echo");
	});

	it("gets tool by short name", () => {
		catalog.addTool(
			"echo",
			{
				description: "Echo",
				parameters: z.object({ msg: z.string() }),
			},
			async (args) => args.msg,
			{ name: "Tools" },
		);

		const tool = catalog.getToolByName("echo");
		expect(tool).toBeDefined();
		expect(tool!.fullyQualifiedName).toBe("Tools_echo");
	});

	it("returns undefined for missing tool", () => {
		expect(catalog.getTool("nonexistent")).toBeUndefined();
	});

	it("removes a tool", () => {
		catalog.addTool(
			"echo",
			{
				description: "Echo",
				parameters: z.object({}),
			},
			async () => {},
		);

		expect(catalog.removeTool("echo")).toBe(true);
		expect(catalog.size).toBe(0);
		expect(catalog.removeTool("echo")).toBe(false);
	});

	it("returns all tool names", () => {
		catalog.addTool(
			"a",
			{ description: "A", parameters: z.object({}) },
			async () => {},
		);
		catalog.addTool(
			"b",
			{ description: "B", parameters: z.object({}) },
			async () => {},
		);

		const names = catalog.getToolNames();
		expect(names).toHaveLength(2);
		expect(names).toContain("a");
		expect(names).toContain("b");
	});

	it("iterates all tools", () => {
		catalog.addTool(
			"a",
			{ description: "A", parameters: z.object({}) },
			async () => {},
		);
		catalog.addTool(
			"b",
			{ description: "B", parameters: z.object({}) },
			async () => {},
		);

		const tools = Array.from(catalog.getAll());
		expect(tools).toHaveLength(2);
	});

	it("stores auth and secrets on tools", () => {
		catalog.addTool(
			"starred",
			{
				description: "Star repo",
				parameters: z.object({ repo: z.string() }),
				auth: {
					providerId: "github",
					providerType: "oauth2",
					scopes: ["repo"],
				},
				secrets: ["GITHUB_TOKEN"],
			},
			async () => {},
		);

		const tool = catalog.getTool("starred")!;
		expect(tool.auth?.providerId).toBe("github");
		expect(tool.secrets).toEqual(["GITHUB_TOKEN"]);
	});
});

describe("toToolDefinition", () => {
	it("converts MaterializedTool to wire format", () => {
		const catalog = new ToolCatalog();
		catalog.addTool(
			"echo",
			{
				description: "Echo a message",
				parameters: z.object({
					message: z.string().describe("The message"),
					count: z.number().optional(),
				}),
			},
			async (args) => args.message,
			{ name: "MyToolkit" },
		);

		const tool = catalog.getTool("MyToolkit_echo")!;
		const def = toToolDefinition(tool);

		expect(def.name).toBe("MyToolkit_echo");
		expect(def.description).toBe("Echo a message");
		expect(def.toolkit?.name).toBe("MyToolkit");
		expect(def.inputSchema).toHaveProperty("type", "object");
		expect(def.inputSchema).toHaveProperty("properties");

		const props = def.inputSchema.properties as Record<string, unknown>;
		expect(props.message).toEqual({
			type: "string",
			description: "The message",
		});
	});

	it("includes toolkit version and description in wire format", () => {
		const catalog = new ToolCatalog();
		catalog.addTool(
			"echo",
			{
				description: "Echo a message",
				parameters: z.object({ message: z.string() }),
			},
			async (args) => args.message,
			{ name: "MyToolkit", version: "1.2.0", description: "My toolkit" },
		);

		const tool = catalog.getTool("MyToolkit_echo")!;
		const def = toToolDefinition(tool);

		expect(def.toolkit).toEqual({
			name: "MyToolkit",
			version: "1.2.0",
			description: "My toolkit",
		});
	});

	it("omits undefined version and description from toolkit", () => {
		const catalog = new ToolCatalog();
		catalog.addTool(
			"echo",
			{
				description: "Echo",
				parameters: z.object({}),
			},
			async () => {},
			{ name: "Bare" },
		);

		const def = toToolDefinition(catalog.getTool("Bare_echo")!);
		expect(def.toolkit?.name).toBe("Bare");
		expect(def.toolkit?.version).toBeUndefined();
		expect(def.toolkit?.description).toBeUndefined();
	});
});

describe("toolkit versioning", () => {
	it("stores toolkit version and description on MaterializedTool", () => {
		const catalog = new ToolCatalog();
		catalog.addTool(
			"greet",
			{
				description: "Greet",
				parameters: z.object({}),
			},
			async () => "hello",
			{ name: "MyKit", version: "2.1.0", description: "A toolkit" },
		);

		const tool = catalog.getTool("MyKit_greet")!;
		expect(tool.toolkitVersion).toBe("2.1.0");
		expect(tool.toolkitDescription).toBe("A toolkit");
	});

	it("supports per-tool toolkit override", () => {
		const catalog = new ToolCatalog();
		catalog.addTool(
			"special",
			{
				description: "Special tool",
				parameters: z.object({}),
				toolkit: { name: "OverrideKit", version: "3.0.0" },
			},
			async () => {},
			{ name: "DefaultKit", version: "1.0.0", description: "Default" },
		);

		const tool = catalog.getTool("OverrideKit_special")!;
		expect(tool.toolkitName).toBe("OverrideKit");
		expect(tool.toolkitVersion).toBe("3.0.0");
		// Falls back to app-level description since override didn't specify one
		expect(tool.toolkitDescription).toBe("Default");
	});

	it("normalizes partial versions during addTool", () => {
		const catalog = new ToolCatalog();
		catalog.addTool(
			"t",
			{ description: "T", parameters: z.object({}) },
			async () => {},
			{ name: "Kit", version: "v2" },
		);

		expect(catalog.getTool("Kit_t")!.toolkitVersion).toBe("2.0.0");
	});
});

describe("normalizeVersion", () => {
	it("passes through valid semver", () => {
		expect(normalizeVersion("1.2.3")).toBe("1.2.3");
	});

	it("strips leading v", () => {
		expect(normalizeVersion("v1.2.3")).toBe("1.2.3");
		expect(normalizeVersion("V1.2.3")).toBe("1.2.3");
	});

	it("expands major-only to full semver", () => {
		expect(normalizeVersion("1")).toBe("1.0.0");
		expect(normalizeVersion("v2")).toBe("2.0.0");
	});

	it("expands major.minor to full semver", () => {
		expect(normalizeVersion("1.2")).toBe("1.2.0");
	});

	it("preserves prerelease and build metadata", () => {
		expect(normalizeVersion("1.0.0-beta.1")).toBe("1.0.0-beta.1");
		expect(normalizeVersion("1.0.0+build.42")).toBe("1.0.0+build.42");
	});

	it("throws on invalid version strings", () => {
		expect(() => normalizeVersion("abc")).toThrow(ToolDefinitionError);
		expect(() => normalizeVersion("")).toThrow(ToolDefinitionError);
		expect(() => normalizeVersion("1.2.3.4")).toThrow(ToolDefinitionError);
	});
});
