import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createLogger } from "../logger.js";
import type { ArcadeMCPServer } from "../server.js";
import { setupGracefulShutdown } from "./shutdown.js";

const logger = createLogger("arcade-mcp-stdio");

/**
 * Run the server using stdio transport.
 * Reads JSON-RPC messages from stdin, writes responses to stdout.
 */
export async function runStdio(server: ArcadeMCPServer): Promise<void> {
  const transport = new StdioServerTransport();

  logger.info("Starting Arcade MCP server on stdio");

  await server.getServer().connect(transport);

  // Resolve on normal client disconnect OR signal-triggered shutdown
  const transportClosed = new Promise<void>((resolve) => {
    transport.onclose = () => {
      logger.info("Stdio transport closed");
      resolve();
    };
  });

  const shutdownRequested = setupGracefulShutdown({
    logger,
    onShutdown: async () => {
      await server.getServer().close();
    },
  });

  await Promise.race([transportClosed, shutdownRequested]);
}
