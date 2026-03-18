import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";

async function waitForServer(url: string, timeoutMs = 10000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			// Use GET which returns 405 — proves the server is listening
			// without creating an MCP session
			await fetch(url);
			return;
		} catch {
			await new Promise((r) => setTimeout(r, 100));
		}
	}
	throw new Error(`Server did not start within ${timeoutMs}ms`);
}

describe("HTTP integration", () => {
	it("connects to echo server over HTTP and calls tools", async () => {
		const port = 9000 + Math.floor(Math.random() * 1000);
		const serverPath = resolve(
			import.meta.dirname,
			"../../examples/echo/server.ts",
		);

		const serverProcess = spawn("bun", ["run", serverPath], {
			env: {
				...process.env,
				ARCADE_SERVER_TRANSPORT: "http",
				ARCADE_SERVER_PORT: String(port),
			},
			stdio: "pipe",
		});

		try {
			const baseUrl = `http://127.0.0.1:${port}`;
			await waitForServer(`${baseUrl}/mcp`);

			const transport = new StreamableHTTPClientTransport(
				new URL(`${baseUrl}/mcp`),
			);

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
		} finally {
			serverProcess.kill();
		}
	}, 15000);
});
