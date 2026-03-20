import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import {
  examplePath,
  randomPort,
  runtimeCommand,
  startHttpServer,
} from "./helpers.js";

// ── Fixtures ────────────────────────────────────────────────

interface ExampleFixture {
  example: string;
  expectedTools: string[];
  smokeCall: { tool: string; args: Record<string, unknown> };
  /** Validate the smoke call result content array. */
  checkResult: (content: unknown[]) => void;
}

const examples: ExampleFixture[] = [
  {
    example: "echo",
    expectedTools: [
      "EchoServer.echo",
      "EchoServer.echo_upper",
      "EchoServer.reverse",
    ],
    smokeCall: { tool: "EchoServer.echo", args: { message: "test" } },
    checkResult: (content) =>
      expect(content).toEqual([{ type: "text", text: "test" }]),
  },
  {
    example: "modular-tools",
    expectedTools: [
      "ModularTools.add",
      "ModularTools.multiply",
      "ModularTools.divide",
      "ModularTools.capitalize",
      "ModularTools.slugify",
      "ModularTools.word_count",
      "ModularTools.echo_with_logging",
    ],
    smokeCall: { tool: "ModularTools.add", args: { a: 2, b: 3 } },
    checkResult: (content) => {
      const text = (content[0] as { text: string }).text;
      expect(JSON.parse(text)).toEqual({ result: 5 });
    },
  },
  {
    example: "middleware-logging",
    expectedTools: [
      "MathServer.add",
      "MathServer.multiply",
      "MathServer.divide",
    ],
    smokeCall: { tool: "MathServer.add", args: { a: 2, b: 3 } },
    checkResult: (content) => {
      const text = (content[0] as { text: string }).text;
      expect(JSON.parse(text)).toEqual({ result: 5 });
    },
  },
];

// Elysia's HTTP server requires Bun — Node can only be tested over stdio.
const matrix = [
  { runtime: "bun" as const, transport: "stdio" },
  { runtime: "bun" as const, transport: "http" },
  { runtime: "node" as const, transport: "stdio" },
];

// ── Tests ───────────────────────────────────────────────────

describe.each(matrix)("$runtime + $transport", ({ runtime, transport }) => {
  describe.each(examples)("$example example", ({
    example,
    expectedTools,
    smokeCall,
    checkResult,
  }) => {
    it("lists and calls tools", async () => {
      const serverPath = examplePath(example);

      if (transport === "stdio") {
        await testStdio(
          runtime,
          serverPath,
          expectedTools,
          smokeCall,
          checkResult,
        );
      } else {
        await testHttp(
          runtime,
          serverPath,
          expectedTools,
          smokeCall,
          checkResult,
        );
      }
    }, 30_000);
  });
});

// ── Transport helpers ───────────────────────────────────────

async function testStdio(
  runtime: "bun" | "node",
  serverPath: string,
  expectedTools: string[],
  smokeCall: { tool: string; args: Record<string, unknown> },
  checkResult: (content: unknown[]) => void,
) {
  const { command, args } = runtimeCommand(runtime, serverPath);
  const stdioTransport = new StdioClientTransport({ command, args });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(stdioTransport);

  try {
    await assertToolsAndCall(client, expectedTools, smokeCall, checkResult);
  } finally {
    await client.close();
  }
}

async function testHttp(
  runtime: "bun" | "node",
  serverPath: string,
  expectedTools: string[],
  smokeCall: { tool: string; args: Record<string, unknown> },
  checkResult: (content: unknown[]) => void,
) {
  const port = randomPort();
  const proc = await startHttpServer(runtime, serverPath, port);

  try {
    const httpTransport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
    );
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(httpTransport);

    try {
      await assertToolsAndCall(client, expectedTools, smokeCall, checkResult);
    } finally {
      await client.close();
    }
  } finally {
    proc.kill();
  }
}

async function assertToolsAndCall(
  client: Client,
  expectedTools: string[],
  smokeCall: { tool: string; args: Record<string, unknown> },
  checkResult: (content: unknown[]) => void,
) {
  // List tools and verify all expected tools are present
  const tools = await client.listTools();
  const toolNames = tools.tools.map((t) => t.name);
  for (const expected of expectedTools) {
    expect(toolNames).toContain(expected);
  }

  // Call one tool and verify the result
  const result = await client.callTool({
    name: smokeCall.tool,
    arguments: smokeCall.args,
  });
  expect(result.isError).toBeFalsy();
  checkResult(result.content as unknown[]);
}
