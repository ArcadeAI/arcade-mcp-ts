/**
 * HTTP session manager with lifecycle management.
 *
 * Provides stateful (session reuse) and stateless (fresh-per-request) modes,
 * TTL-based session eviction, max session caps, and graceful shutdown.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type HandleRequestOptions,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { EventStore } from "../event-store.js";
import { createLogger } from "../logger.js";
import type { ArcadeMCPServer } from "../server.js";

const logger = createLogger("arcade-mcp-session-manager");

interface SessionEntry {
  transport: WebStandardStreamableHTTPServerTransport;
  mcpServer: McpServer;
  createdAt: number;
  lastAccessedAt: number;
}

export interface HTTPSessionManagerOptions {
  /** The ArcadeMCPServer to create per-session servers from. */
  server: ArcadeMCPServer;
  /** If true, create a fresh transport per request with no session reuse. */
  stateless?: boolean;
  /** Shared event store for stream resumability. */
  eventStore?: EventStore;
  /** Sliding-window TTL in ms per session. Undefined = no eviction. */
  sessionTtlMs?: number;
  /** Max concurrent sessions. Undefined = unlimited. */
  maxSessions?: number;
}

export class HTTPSessionManager {
  private sessions = new Map<string, SessionEntry>();
  private ttlTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private creationLock: Promise<void> | null = null;
  private closed = false;

  private readonly server: ArcadeMCPServer;
  private readonly stateless: boolean;
  private readonly eventStore?: EventStore;
  private readonly sessionTtlMs?: number;
  private readonly maxSessions?: number;

  constructor(options: HTTPSessionManagerOptions) {
    this.server = options.server;
    this.stateless = options.stateless ?? false;
    this.eventStore = options.eventStore;
    this.sessionTtlMs = options.sessionTtlMs;
    this.maxSessions = options.maxSessions;
  }

  /** Number of active sessions. */
  get sessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Handle an incoming HTTP request.
   * Routes to the appropriate transport based on session state and mode.
   */
  async handleRequest(
    request: Request,
    extra?: HandleRequestOptions,
  ): Promise<Response> {
    if (this.closed) {
      return jsonResponse(503, { error: "Server is shutting down" });
    }

    if (this.stateless) {
      return this.handleStatelessRequest(request, extra);
    }
    return this.handleStatefulRequest(request, extra);
  }

  /** Gracefully close all sessions and prevent new ones. */
  async close(): Promise<void> {
    this.closed = true;

    // Clear all TTL timers
    for (const timer of this.ttlTimers.values()) {
      clearTimeout(timer);
    }
    this.ttlTimers.clear();

    // Close all sessions
    const closePromises = [...this.sessions.entries()].map(
      async ([id, entry]) => {
        this.sessions.delete(id);
        await entry.transport.close().catch(() => {});
        await entry.mcpServer.close().catch(() => {});
      },
    );
    await Promise.all(closePromises);
  }

  // ── Stateless mode ──────────────────────────────────────

  private async handleStatelessRequest(
    request: Request,
    extra?: HandleRequestOptions,
  ): Promise<Response> {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      eventStore: this.eventStore,
    });

    const sessionServer = this.server.createSessionServer();
    await sessionServer.connect(transport);

    // Clean up after the transport closes
    transport.onclose = () => {
      sessionServer.close().catch(() => {});
    };

    try {
      return await transport.handleRequest(request, extra);
    } catch (error) {
      // Ensure cleanup on error
      await transport.close().catch(() => {});
      await sessionServer.close().catch(() => {});
      throw error;
    }
  }

  // ── Stateful mode ───────────────────────────────────────

  private async handleStatefulRequest(
    request: Request,
    extra?: HandleRequestOptions,
  ): Promise<Response> {
    const sessionId = request.headers.get("mcp-session-id");

    if (sessionId) {
      return this.handleExistingSession(sessionId, request, extra);
    }

    if (request.method === "POST") {
      return this.handleNewSession(request, extra);
    }

    return jsonResponse(400, { error: "Missing session ID" });
  }

  private async handleExistingSession(
    sessionId: string,
    request: Request,
    extra?: HandleRequestOptions,
  ): Promise<Response> {
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      return jsonResponse(400, { error: "Invalid session" });
    }

    entry.lastAccessedAt = Date.now();
    this.resetTtlTimer(sessionId);

    return entry.transport.handleRequest(request, extra);
  }

  private async handleNewSession(
    request: Request,
    extra?: HandleRequestOptions,
  ): Promise<Response> {
    return this.withCreationLock(async () => {
      // Check capacity
      if (
        this.maxSessions !== undefined &&
        this.sessions.size >= this.maxSessions
      ) {
        return jsonResponse(503, { error: "Max sessions reached" });
      }

      const sessionServer = this.server.createSessionServer();

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        eventStore: this.eventStore,
        onsessioninitialized: (id: string) => {
          const now = Date.now();
          this.sessions.set(id, {
            transport,
            mcpServer: sessionServer,
            createdAt: now,
            lastAccessedAt: now,
          });
          this.resetTtlTimer(id);
          logger.debug({ sessionId: id }, "Session created");
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) {
          this.evictSession(sid);
        }
      };

      await sessionServer.connect(transport);

      return transport.handleRequest(request, extra);
    });
  }

  // ── TTL management ──────────────────────────────────────

  private resetTtlTimer(sessionId: string): void {
    if (this.sessionTtlMs === undefined) return;

    const existing = this.ttlTimers.get(sessionId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      logger.debug({ sessionId }, "Session expired (TTL)");
      this.evictSession(sessionId);
    }, this.sessionTtlMs);

    // Don't let TTL timers keep the process alive
    if (timer.unref) timer.unref();

    this.ttlTimers.set(sessionId, timer);
  }

  private evictSession(sessionId: string): void {
    const timer = this.ttlTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.ttlTimers.delete(sessionId);
    }

    const entry = this.sessions.get(sessionId);
    if (entry) {
      this.sessions.delete(sessionId);
      entry.transport.close().catch(() => {});
      entry.mcpServer.close().catch(() => {});
      logger.debug({ sessionId }, "Session evicted");
    }
  }

  // ── Creation lock ───────────────────────────────────────

  private async withCreationLock<T>(fn: () => Promise<T>): Promise<T> {
    // Wait for any in-progress creation to finish
    while (this.creationLock) {
      await this.creationLock;
    }

    let resolve: () => void;
    this.creationLock = new Promise<void>((r) => {
      resolve = r;
    });

    try {
      return await fn();
    } finally {
      this.creationLock = null;
      resolve!();
    }
  }
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
