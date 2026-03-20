import { describe, expect, it } from "vitest";
import { NotFoundError, PromptError } from "../../src/exceptions.js";
import { PromptManager } from "../../src/managers/prompt-manager.js";

describe("PromptManager", () => {
  it("adds and lists prompts", () => {
    const pm = new PromptManager();
    pm.addPrompt("greeting", { description: "A greeting prompt" });
    pm.addPrompt("farewell", { description: "A farewell prompt" });

    const prompts = pm.listPrompts();
    expect(prompts).toHaveLength(2);
    expect(pm.getPromptNames()).toEqual(["farewell", "greeting"]);
  });

  it("removes a prompt", () => {
    const pm = new PromptManager();
    pm.addPrompt("greeting", { description: "A greeting prompt" });

    const removed = pm.removePrompt("greeting");
    expect(removed.name).toBe("greeting");
    expect(pm.listPrompts()).toHaveLength(0);
  });

  it("throws when removing non-existent prompt", () => {
    const pm = new PromptManager();
    expect(() => pm.removePrompt("missing")).toThrow("Key not found");
  });

  it("calls handler with arguments", async () => {
    const pm = new PromptManager();
    pm.addPrompt(
      "greet",
      {
        description: "Greet someone",
        arguments: [{ name: "name", required: true }],
      },
      (args) => ({
        messages: [
          {
            role: "user",
            content: { type: "text", text: `Hello, ${args.name}!` },
          },
        ],
      }),
    );

    const result = await pm.getPrompt("greet", { name: "Alice" });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toEqual({
      type: "text",
      text: "Hello, Alice!",
    });
  });

  it("validates required arguments", async () => {
    const pm = new PromptManager();
    pm.addPrompt("greet", {
      description: "Greet someone",
      arguments: [
        { name: "name", required: true },
        { name: "title", required: false },
      ],
    });

    await expect(pm.getPrompt("greet", {})).rejects.toThrow(
      "Missing required argument 'name'",
    );
  });

  it("throws NotFoundError when getting non-existent prompt", async () => {
    const pm = new PromptManager();
    await expect(pm.getPrompt("missing")).rejects.toThrow(NotFoundError);
    await expect(pm.getPrompt("missing")).rejects.toThrow(
      "Prompt 'missing' not found",
    );
  });

  it("throws PromptError when missing required argument", async () => {
    const pm = new PromptManager();
    pm.addPrompt("greet", {
      description: "Greet",
      arguments: [{ name: "name", required: true }],
    });
    await expect(pm.getPrompt("greet", {})).rejects.toThrow(PromptError);
  });

  it("uses default handler returning description message", async () => {
    const pm = new PromptManager();
    pm.addPrompt("test", { description: "Test description" });

    const result = await pm.getPrompt("test");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({
      role: "user",
      content: { type: "text", text: "Test description" },
    });
  });

  it("supports async handlers", async () => {
    const pm = new PromptManager();
    pm.addPrompt("async", { description: "Async prompt" }, async () => ({
      description: "async result",
      messages: [
        {
          role: "assistant",
          content: { type: "text", text: "async response" },
        },
      ],
    }));

    const result = await pm.getPrompt("async");
    expect(result.description).toBe("async result");
  });
});
