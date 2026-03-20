import { Elysia } from "elysia";
import { registerAuthDiscoveryRoutes } from "../auth/routes.js";
import type { ToolCatalog } from "../catalog.js";
import type { EventStore } from "../event-store.js";
import { createLogger } from "../logger.js";
import type { ArcadeMCPServer } from "../server.js";
import type { OTELHandler } from "../telemetry.js";
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
  /** When set, worker routes are mounted at /worker/*. */
  workerSecret?: string;
  /** Tool catalog — required when workerSecret is set. */
  catalog?: ToolCatalog;
  /** Optional telemetry handler forwarded to worker routes. */
  telemetry?: OTELHandler;
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
      const token = authHeader.slice(7);
      if (!token) {
        return new Response(JSON.stringify({ error: "Missing Bearer token" }), {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "WWW-Authenticate": "Bearer",
          },
        });
      }
      try {
        resourceOwner = await options.auth.validateToken(token);
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
  if (options?.auth) {
    registerAuthDiscoveryRoutes(app, options.auth);
  }

  // Worker routes — conditionally mounted when a secret is provided
  if (options?.workerSecret && options.catalog) {
    const { createWorkerRoutes } = await import("../worker/routes.js");
    const workerApp = createWorkerRoutes({
      catalog: options.catalog,
      secret: options.workerSecret,
      telemetry: options.telemetry,
    });
    app.use(workerApp);
    logger.info(
      "Worker routes enabled at /worker/* (ARCADE_WORKER_SECRET is set)",
    );
  } else {
    logger.debug("Worker routes disabled (ARCADE_WORKER_SECRET is not set)");
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
