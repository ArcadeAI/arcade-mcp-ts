import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

describe("Stdio integration", () => {
	it("connects to echo server and calls tools", async () => {
		const serverPath = resolve(
			import.meta.dirname,
			"../../examples/echo/server.ts",
		);

		const transport = new StdioClientTransport({
			command: "bun",
			args: ["run", serverPath],
		});

		const client = new Client({ name: "test-client", version: "1.0.0" });
		await client.connect(transport);

		// List tools
		const tools = await client.listTools();
		expect(tools.tools.length).toBeGreaterThanOrEqual(3);

		const toolNames = tools.tools.map((t) => t.name);
		expect(toolNames).toContain("EchoServer_echo");
		expect(toolNames).toContain("EchoServer_echo_upper");
		expect(toolNames).toContain("EchoServer_reverse");

		// Call echo tool
		const echoResult = await client.callTool({
			name: "EchoServer_echo",
			arguments: { message: "Hello, world!" },
		});
		expect(echoResult.content).toEqual([
			{ type: "text", text: "Hello, world!" },
		]);

		// Call echo_upper tool
		const upperResult = await client.callTool({
			name: "EchoServer_echo_upper",
			arguments: { message: "hello" },
		});
		expect(upperResult.content).toEqual([{ type: "text", text: "HELLO" }]);

		// Call reverse tool
		const reverseResult = await client.callTool({
			name: "EchoServer_reverse",
			arguments: { text: "abc" },
		});
		expect(reverseResult.content).toEqual([{ type: "text", text: "cba" }]);

		// Test validation error
		const errorResult = await client.callTool({
			name: "EchoServer_echo",
			arguments: { message: 42 },
		});
		expect(errorResult.isError).toBe(true);

		await client.close();
	}, 15000);
});
