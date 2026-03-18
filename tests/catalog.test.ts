import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolCatalog, toToolDefinition } from "../src/catalog.js";
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
			"MyToolkit",
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
			"Tools",
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
			"Tools",
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
			"MyToolkit",
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
});
