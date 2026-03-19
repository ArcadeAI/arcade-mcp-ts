import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolCatalog } from "../../src/catalog.js";
import { EvalToolRegistry } from "../../src/evals/tool-registry.js";

describe("EvalToolRegistry", () => {
  it("adds and lists tools", () => {
    const registry = new EvalToolRegistry();
    registry.addTools([
      {
        name: "echo",
        description: "Echo a message",
        inputSchema: {
          type: "object",
          properties: { message: { type: "string" } },
        },
      },
    ]);

    expect(registry.toolCount()).toBe(1);
    expect(registry.toolNames()).toEqual(["echo"]);
    expect(registry.hasTool("echo")).toBe(true);
  });

  it("resolves normalized tool names", () => {
    const registry = new EvalToolRegistry();
    registry.addTools([{ name: "My.Tool-Name" }]);

    expect(registry.hasTool("My_Tool_Name")).toBe(true);
    expect(registry.resolveToolName("My_Tool_Name")).toBe("My.Tool-Name");
  });

  it("converts to OpenAI format", () => {
    const registry = new EvalToolRegistry();
    registry.addTools([
      {
        name: "Weather.get_forecast",
        description: "Get forecast",
        inputSchema: {
          type: "object",
          properties: {
            city: { type: "string" },
          },
          required: ["city"],
        },
      },
    ]);

    const tools = registry.listToolsForModel("openai");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toEqual({
      type: "function",
      function: {
        name: "Weather_get_forecast",
        description: "Get forecast",
        parameters: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      },
    });
  });

  it("converts to Anthropic format", () => {
    const registry = new EvalToolRegistry();
    registry.addTools([
      {
        name: "echo",
        description: "Echo a message",
        inputSchema: {
          type: "object",
          properties: { message: { type: "string" } },
        },
      },
    ]);

    const tools = registry.listToolsForModel("anthropic");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toEqual({
      name: "echo",
      description: "Echo a message",
      input_schema: {
        type: "object",
        properties: { message: { type: "string" } },
      },
    });
  });

  it("adds tools from a ToolCatalog", () => {
    const catalog = new ToolCatalog();
    catalog.addTool(
      "greet",
      {
        description: "Greet someone",
        parameters: z.object({ name: z.string() }),
      },
      async (args) => `Hello ${args.name}`,
      { name: "TestKit" },
    );

    const registry = new EvalToolRegistry();
    registry.addFromCatalog(catalog);

    expect(registry.toolCount()).toBe(1);
    expect(registry.hasTool("TestKit_greet")).toBe(true);
  });
});
