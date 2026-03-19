import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MCPApp } from "../src/mcp-app.js";

describe("MCPApp", () => {
  it("creates with valid name", () => {
    const app = new MCPApp({ name: "TestServer", version: "1.0.0" });
    expect(app.name).toBe("TestServer");
    expect(app.version).toBe("1.0.0");
  });

  it("rejects invalid names", () => {
    expect(() => new MCPApp({ name: "_bad" })).toThrow("Invalid app name");
    expect(() => new MCPApp({ name: "has space" })).toThrow("Invalid app name");
    expect(() => new MCPApp({ name: "has__double" })).toThrow(
      "Invalid app name",
    );
  });

  it("defaults version to 0.1.0", () => {
    const app = new MCPApp({ name: "Test" });
    expect(app.version).toBe("0.1.0");
  });

  it("defaults title to name", () => {
    const app = new MCPApp({ name: "Test" });
    expect(app.title).toBe("Test");
  });

  it("registers tools via builder pattern", () => {
    const app = new MCPApp({ name: "Test" });

    app.tool(
      "echo",
      {
        description: "Echo",
        parameters: z.object({ msg: z.string() }),
      },
      async (args) => args.msg,
    );

    expect(app.catalog.size).toBe(1);
    expect(app.catalog.has("Test.echo")).toBe(true);
  });

  it("supports method chaining", () => {
    const app = new MCPApp({ name: "Test" });

    const result = app
      .tool("a", { description: "A", parameters: z.object({}) }, async () => {})
      .tool(
        "b",
        { description: "B", parameters: z.object({}) },
        async () => {},
      );

    expect(result).toBe(app);
    expect(app.catalog.size).toBe(2);
  });

  it("registers tools with auth and secrets", () => {
    const app = new MCPApp({ name: "Test" });

    app.tool(
      "star_repo",
      {
        description: "Star a repo",
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

    const tool = app.catalog.getTool("Test.star_repo")!;
    expect(tool.auth?.providerId).toBe("github");
    expect(tool.secrets).toEqual(["GITHUB_TOKEN"]);
  });

  it("addToolsFrom registers multiple tools", () => {
    const app = new MCPApp({ name: "Test" });

    app.addToolsFrom({
      greet: {
        options: {
          description: "Greet",
          parameters: z.object({ name: z.string() }),
        },
        handler: async (args) => `Hello ${args.name}`,
      },
      farewell: {
        options: {
          description: "Farewell",
          parameters: z.object({ name: z.string() }),
        },
        handler: async (args) => `Goodbye ${args.name}`,
      },
    });

    expect(app.catalog.size).toBe(2);
  });

  it("server is undefined before run()", () => {
    const app = new MCPApp({ name: "Test" });
    expect(app.server).toBeUndefined();
  });

  it("tools.add() throws before run()", () => {
    const app = new MCPApp({ name: "Test" });
    expect(() =>
      app.tools.add(
        "test",
        { description: "Test", parameters: z.object({}) },
        async () => {},
      ),
    ).toThrow("Server not started");
  });

  // ── Prompt registration ──────────────────────────────────

  it("registers prompts via builder pattern", () => {
    const app = new MCPApp({ name: "Test" });

    app.prompt("greeting", { description: "A greeting" }, (args) => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text: `Hello ${args.name}` },
        },
      ],
    }));

    expect(app.promptManager.listPrompts()).toHaveLength(1);
    expect(app.promptManager.getPromptNames()).toEqual(["greeting"]);
  });

  it("prompt() supports method chaining", () => {
    const app = new MCPApp({ name: "Test" });

    const result = app
      .prompt("a", { description: "A" })
      .prompt("b", { description: "B" });

    expect(result).toBe(app);
    expect(app.promptManager.listPrompts()).toHaveLength(2);
  });

  it("prompts.add() throws before run()", () => {
    const app = new MCPApp({ name: "Test" });
    expect(() => app.prompts.add("test", { description: "Test" })).toThrow(
      "Server not started",
    );
  });

  // ── Resource registration ────────────────────────────────

  it("registers resources via builder pattern", () => {
    const app = new MCPApp({ name: "Test" });

    app.resource("file:///config.json", { description: "Config" }, (uri) => ({
      contents: [{ uri: uri.href, text: "{}" }],
    }));

    expect(app.resourceManager.listResources()).toHaveLength(1);
    expect(app.resourceManager.getResourceUris()).toEqual([
      "file:///config.json",
    ]);
  });

  it("resource() supports method chaining", () => {
    const app = new MCPApp({ name: "Test" });

    const result = app
      .resource("file:///a", { description: "A" })
      .resource("file:///b", { description: "B" });

    expect(result).toBe(app);
    expect(app.resourceManager.listResources()).toHaveLength(2);
  });

  it("resources.add() throws before run()", () => {
    const app = new MCPApp({ name: "Test" });
    expect(() =>
      app.resources.add("file:///test", { description: "Test" }),
    ).toThrow("Server not started");
  });

  // ── Mixed registration ───────────────────────────────────

  it("chains tools, prompts, and resources together", () => {
    const app = new MCPApp({ name: "Test" });

    app
      .tool(
        "echo",
        { description: "Echo", parameters: z.object({ msg: z.string() }) },
        async (args) => args.msg,
      )
      .prompt("greeting", { description: "Greet" })
      .resource("file:///config", { description: "Config" });

    expect(app.catalog.size).toBe(1);
    expect(app.promptManager.listPrompts()).toHaveLength(1);
    expect(app.resourceManager.listResources()).toHaveLength(1);
  });
});
