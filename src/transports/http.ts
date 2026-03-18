import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Elysia } from "elysia";
import { createLogger } from "../logger.js";
import type { ArcadeMCPServer } from "../server.js";
import type {
	ResourceOwner,
	ResourceServerValidatorInterface,
} from "../types.js";
import { setupGracefulShutdown } from "./shutdown.js";

const logger = createLogger("arcade-mcp-http");

export interface HttpOptions {
	host?: string;
	port?: number;
	auth?: ResourceServerValidatorInterface;
}

/**
 * Run the server using HTTP transport with Elysia.
 * Uses WebStandardStreamableHTTPServerTransport for MCP over HTTP.
 * Blocks until a shutdown signal is received.
 */
export async function runHttp(
	server: ArcadeMCPServer,
	options?: HttpOptions,
): Promise<void> {
	const host = options?.host ?? "127.0.0.1";
	const port = options?.port ?? 8000;

	const app = new Elysia();

	// Track transports and per-session McpServer instances
	const sessions = new Map<
		string,
		{
			transport: WebStandardStreamableHTTPServerTransport;
			mcpServer: McpServer;
		}
	>();

	// MCP endpoint
	app.all("/mcp", async ({ request }) => {
		// Auth validation for HTTP
		let resourceOwner: ResourceOwner | undefined;
		if (options?.auth) {
			const authHeader = request.headers.get("authorization");
			if (!authHeader?.startsWith("Bearer ")) {
				return new Response(JSON.stringify({ error: "Missing Bearer token" }), {
					status: 401,
					headers: {
						"Content-Type": "application/json",
						"WWW-Authenticate": "Bearer",
					},
				});
			}
			try {
				resourceOwner = await options.auth.validateToken(authHeader.slice(7));
			} catch {
				return new Response(JSON.stringify({ error: "Invalid token" }), {
					status: 401,
					headers: {
						"Content-Type": "application/json",
						"WWW-Authenticate": "Bearer",
					},
				});
			}
		}

		// Look up existing session transport
		const sessionId = request.headers.get("mcp-session-id");
		let transport: WebStandardStreamableHTTPServerTransport | undefined;

		if (sessionId) {
			transport = sessions.get(sessionId)?.transport;
		}

		// Only create new transports for POST requests (initialization)
		if (!transport && request.method === "POST") {
			transport = new WebStandardStreamableHTTPServerTransport({
				sessionIdGenerator: () => crypto.randomUUID(),
				onsessioninitialized: (id: string) => {
					sessions.set(id, { transport: transport!, mcpServer: sessionServer });
				},
			});

			transport.onclose = () => {
				const sid = transport!.sessionId;
				if (sid) {
					const entry = sessions.get(sid);
					sessions.delete(sid);
					entry?.mcpServer.close().catch(() => {});
				}
			};

			const sessionServer = server.createSessionServer();
			await sessionServer.connect(transport);
		}

		if (!transport) {
			return new Response(JSON.stringify({ error: "Session not found" }), {
				status: 404,
				headers: { "Content-Type": "application/json" },
			});
		}

		// Delegate to the web standard transport
		return transport.handleRequest(request, {
			authInfo: resourceOwner
				? {
						token: "",
						clientId: resourceOwner.clientId ?? "",
						scopes: [],
						extra: {
							userId: resourceOwner.userId,
							email: resourceOwner.email,
							claims: resourceOwner.claims,
						},
					}
				: undefined,
		});
	});

	// OAuth discovery endpoint (RFC 9728)
	if (options?.auth?.supportsOAuthDiscovery?.()) {
		app.get("/.well-known/oauth-protected-resource", () => {
			const metadata = options?.auth?.getResourceMetadata?.();
			if (metadata) {
				return new Response(JSON.stringify(metadata), {
					headers: { "Content-Type": "application/json" },
				});
			}
			return new Response(null, { status: 404 });
		});
	}

	app.listen({ hostname: host, port });
	logger.info(`Arcade MCP HTTP server listening on ${host}:${port}`);

	// Block until shutdown signal
	await setupGracefulShutdown({
		logger,
		onShutdown: async () => {
			const closePromises = [...sessions.values()].map(async (entry) => {
				await entry.transport.close().catch(() => {});
				await entry.mcpServer.close().catch(() => {});
			});
			await Promise.all(closePromises);
			app.stop();
		},
	});
}
