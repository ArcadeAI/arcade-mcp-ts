import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pino from "pino";
import type { ArcadeMCPServer } from "../server.js";

const logger = pino({ name: "arcade-mcp-stdio" });

/**
 * Run the server using stdio transport.
 * Reads JSON-RPC messages from stdin, writes responses to stdout.
 */
export async function runStdio(server: ArcadeMCPServer): Promise<void> {
	const transport = new StdioServerTransport();

	logger.info("Starting Arcade MCP server on stdio");

	await server.getServer().connect(transport);

	// Keep process alive until transport closes
	await new Promise<void>((resolve) => {
		transport.onclose = () => {
			logger.info("Stdio transport closed");
			resolve();
		};

		// Handle process signals
		const cleanup = () => {
			server
				.getServer()
				.close()
				.then(() => resolve())
				.catch(() => resolve());
		};

		process.on("SIGINT", cleanup);
		process.on("SIGTERM", cleanup);
	});
}
