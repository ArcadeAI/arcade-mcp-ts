import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Elysia } from "elysia";
import pino from "pino";
import type { ArcadeMCPServer } from "../server.js";
import type {
	ResourceOwner,
	ResourceServerValidatorInterface,
} from "../types.js";

const logger = pino({ name: "arcade-mcp-http" });

export interface HttpOptions {
	host?: string;
	port?: number;
	auth?: ResourceServerValidatorInterface;
}

/**
 * Run the server using HTTP transport with Elysia.
 * Uses StreamableHTTPServerTransport for MCP over HTTP.
 */
export async function runHttp(
	server: ArcadeMCPServer,
	options?: HttpOptions,
): Promise<Elysia> {
	const host = options?.host ?? "127.0.0.1";
	const port = options?.port ?? 8000;

	const app = new Elysia();

	// Track transports per session
	const transports = new Map<string, StreamableHTTPServerTransport>();

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

		// Handle based on method
		if (request.method === "POST") {
			const body = await request.json();

			// Check for existing session
			const sessionId = request.headers.get("mcp-session-id");
			let transport: StreamableHTTPServerTransport;

			if (sessionId && transports.has(sessionId)) {
				transport = transports.get(sessionId)!;
			} else {
				// Create new transport for this session
				transport = new StreamableHTTPServerTransport({
					sessionIdGenerator: () => crypto.randomUUID(),
				});

				// Connect to server
				await server.getServer().connect(transport);

				transport.onclose = () => {
					if (transport.sessionId) {
						transports.delete(transport.sessionId);
					}
				};

				if (transport.sessionId) {
					transports.set(transport.sessionId, transport);
				}
			}

			// Create Node.js-like req/res for the transport
			const { writable } = new TransformStream();
			const writer = writable.getWriter();

			// Convert to IncomingMessage-like object for SDK
			const headers: Record<string, string> = {};
			request.headers.forEach((value, key) => {
				headers[key] = value;
			});

			// Inject resource owner as auth info
			const req = {
				method: request.method,
				url: new URL(request.url).pathname,
				headers,
				body,
				auth: resourceOwner ? { ...resourceOwner } : undefined,
			};

			const responseHeaders: Record<string, string> = {};
			let statusCode = 200;
			let responseBody = "";

			const res = {
				writeHead: (code: number, hdrs?: Record<string, string>) => {
					statusCode = code;
					if (hdrs) Object.assign(responseHeaders, hdrs);
					return res;
				},
				setHeader: (name: string, value: string) => {
					responseHeaders[name] = value;
				},
				getHeader: (name: string) => responseHeaders[name],
				write: (chunk: string) => {
					responseBody += chunk;
					return true;
				},
				end: (chunk?: string) => {
					if (chunk) responseBody += chunk;
					writer.close().catch(() => {});
				},
				on: () => res,
				flushHeaders: () => {},
			};

			await transport.handleRequest(req as never, res as never, body);

			return new Response(responseBody || null, {
				status: statusCode,
				headers: responseHeaders,
			});
		}

		// DELETE — close session
		if (request.method === "DELETE") {
			const sessionId = request.headers.get("mcp-session-id");
			if (sessionId && transports.has(sessionId)) {
				const transport = transports.get(sessionId)!;
				await transport.close();
				transports.delete(sessionId);
			}
			return new Response(null, { status: 204 });
		}

		return new Response("Method not allowed", { status: 405 });
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

	return app;
}
