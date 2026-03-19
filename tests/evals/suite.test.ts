import { describe, expect, it, vi } from "vitest";
import { BinaryCritic } from "../../src/evals/critics.js";
import { EvalSuite } from "../../src/evals/suite.js";

describe("EvalSuite", () => {
  it("registers tool definitions", () => {
    const suite = new EvalSuite({
      name: "test",
      systemMessage: "You are helpful.",
    });

    suite.addToolDefinitions([
      {
        name: "echo",
        description: "Echo a message",
        inputSchema: {
          type: "object",
          properties: { message: { type: "string" } },
        },
      },
    ]);

    expect(suite.getRegistry().toolCount()).toBe(1);
  });

  it("runs with mock OpenAI client", async () => {
    const suite = new EvalSuite({
      name: "test",
      systemMessage: "You are helpful.",
    });

    suite.addToolDefinitions([
      {
        name: "echo",
        description: "Echo a message",
        inputSchema: {
          type: "object",
          properties: { message: { type: "string" } },
        },
      },
    ]);

    suite.addCase({
      name: "Echo hello",
      userMessage: 'Echo "hello"',
      expectedToolCalls: [{ toolName: "echo", args: { message: "hello" } }],
      critics: [new BinaryCritic({ field: "message" })],
    });

    // Mock OpenAI client
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      function: {
                        name: "echo",
                        arguments: JSON.stringify({
                          message: "hello",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        },
      },
    };

    const results = await suite.run({
      client: mockClient,
      model: "gpt-4o-mini",
    });

    expect(results.suiteName).toBe("test");
    expect(results.provider).toBe("openai");
    expect(results.cases).toHaveLength(1);
    expect(results.cases[0].evaluation.passed).toBe(true);
    expect(results.cases[0].evaluation.score).toBe(1.0);
  });

  it("runs with mock Anthropic client", async () => {
    const suite = new EvalSuite({
      name: "test",
      systemMessage: "You are helpful.",
    });

    suite.addToolDefinitions([
      {
        name: "greet",
        description: "Greet someone",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string" } },
        },
      },
    ]);

    suite.addCase({
      name: "Greet Alice",
      userMessage: "Greet Alice",
      expectedToolCalls: [{ toolName: "greet", args: { name: "Alice" } }],
      critics: [new BinaryCritic({ field: "name" })],
    });

    // Mock Anthropic client
    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            {
              type: "tool_use",
              name: "greet",
              input: { name: "Alice" },
            },
          ],
        }),
      },
    };

    const results = await suite.run({
      client: mockClient,
      model: "claude-sonnet-4-20250514",
      provider: "anthropic",
    });

    expect(results.provider).toBe("anthropic");
    expect(results.cases[0].evaluation.passed).toBe(true);
  });

  it("detects OpenAI provider from client", async () => {
    const suite = new EvalSuite({
      name: "test",
      systemMessage: "test",
    });

    suite.addToolDefinitions([{ name: "test" }]);
    suite.addCase({
      name: "test",
      userMessage: "test",
      expectedToolCalls: [{ toolName: "test", args: {} }],
    });

    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      function: {
                        name: "test",
                        arguments: "{}",
                      },
                    },
                  ],
                },
              },
            ],
          }),
        },
      },
    };

    const results = await suite.run({
      client: mockClient,
      model: "gpt-4o",
    });
    expect(results.provider).toBe("openai");
  });

  it("detects Anthropic provider from client", async () => {
    const suite = new EvalSuite({
      name: "test",
      systemMessage: "test",
    });

    suite.addToolDefinitions([{ name: "test" }]);
    suite.addCase({
      name: "test",
      userMessage: "test",
      expectedToolCalls: [{ toolName: "test", args: {} }],
    });

    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "tool_use", name: "test", input: {} }],
        }),
      },
    };

    const results = await suite.run({
      client: mockClient,
      model: "claude-sonnet-4-20250514",
    });
    expect(results.provider).toBe("anthropic");
  });

  it("handles LLM returning no tool calls", async () => {
    const suite = new EvalSuite({
      name: "test",
      systemMessage: "test",
    });

    suite.addToolDefinitions([{ name: "echo" }]);
    suite.addCase({
      name: "test",
      userMessage: "test",
      expectedToolCalls: [{ toolName: "echo", args: { message: "hello" } }],
    });

    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: "I cannot do that." } }],
          }),
        },
      },
    };

    const results = await suite.run({
      client: mockClient,
      model: "gpt-4o",
    });

    expect(results.cases[0].evaluation.passed).toBe(false);
    expect(results.cases[0].actualToolCalls).toHaveLength(0);
  });

  it("runs multiple cases", async () => {
    const suite = new EvalSuite({
      name: "test",
      systemMessage: "test",
    });

    suite.addToolDefinitions([{ name: "echo" }, { name: "reverse" }]);

    suite.addCase({
      name: "case1",
      userMessage: "echo hello",
      expectedToolCalls: [{ toolName: "echo", args: { message: "hello" } }],
      critics: [new BinaryCritic({ field: "message" })],
    });

    suite.addCase({
      name: "case2",
      userMessage: "reverse world",
      expectedToolCalls: [{ toolName: "reverse", args: { text: "world" } }],
      critics: [new BinaryCritic({ field: "text" })],
    });

    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      function: {
                        name: "echo",
                        arguments: JSON.stringify({
                          message: "hello",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
        },
      },
    };

    const results = await suite.run({
      client: mockClient,
      model: "gpt-4o",
    });

    expect(results.cases).toHaveLength(2);
  });
});
