import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Elysia } from "elysia";
import pino from "pino";
import type { ArcadeMCPServer } from "../server.js";
import type {
	ResourceOwner,
	ResourceServerValidatorInterface,
} from "../types.js";
import { setupGracefulShutdown } from "./shutdown.js";

const logger = pino({ name: "arcade-mcp-http" });

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

	// Track transports per session for multi-session support
	const transports = new Map<
		string,
		WebStandardStreamableHTTPServerTransport
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
			transport = transports.get(sessionId);
		}

		// Only create new transports for POST requests (initialization)
		if (!transport && request.method === "POST") {
			transport = new WebStandardStreamableHTTPServerTransport({
				sessionIdGenerator: () => crypto.randomUUID(),
				onsessioninitialized: (id: string) => {
					transports.set(id, transport!);
				},
			});

			transport.onclose = () => {
				const sid = transport!.sessionId;
				if (sid) {
					transports.delete(sid);
				}
			};

			await server.getServer().connect(transport);
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
			// Close all active session transports
			const closePromises = [...transports.values()].map((t) =>
				t.close().catch(() => {}),
			);
			await Promise.all(closePromises);

			await server.getServer().close();
			app.stop();
		},
	});
}
