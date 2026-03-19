import { Elysia } from "elysia";
import type { EventStore } from "../event-store.js";
import { createLogger } from "../logger.js";
import type { ArcadeMCPServer } from "../server.js";
import type {
  ResourceOwner,
  ResourceServerValidatorInterface,
} from "../types.js";
import { HTTPSessionManager } from "./http-session-manager.js";
import { setupGracefulShutdown } from "./shutdown.js";

const logger = createLogger("arcade-mcp-http");

export interface HttpOptions {
  host?: string;
  port?: number;
  auth?: ResourceServerValidatorInterface;
  eventStore?: EventStore;
  stateless?: boolean;
  sessionTtlMs?: number;
  maxSessions?: number;
}

/**
 * Handle returned by startHttp — allows stopping the server.
 */
export interface HttpHandle {
  /** Stop the HTTP server and close all sessions. */
  stop(): Promise<void>;
}

/**
 * Start the HTTP server without blocking.
 * Returns a handle that can be used to stop the server.
 */
export async function startHttp(
  server: ArcadeMCPServer,
  options?: HttpOptions,
): Promise<HttpHandle> {
  const host = options?.host ?? "127.0.0.1";
  const port = options?.port ?? 8000;

  const app = new Elysia();

  const sessionManager = new HTTPSessionManager({
    server,
    stateless: options?.stateless,
    eventStore: options?.eventStore,
    sessionTtlMs: options?.sessionTtlMs,
    maxSessions: options?.maxSessions,
  });

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

    const authInfo = resourceOwner
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
      : undefined;

    return sessionManager.handleRequest(request, {
      authInfo,
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

  return {
    async stop() {
      await sessionManager.close();
      app.stop();
    },
  };
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
  const handle = await startHttp(server, options);

  // Block until shutdown signal
  await setupGracefulShutdown({
    logger,
    onShutdown: () => handle.stop(),
  });
}
