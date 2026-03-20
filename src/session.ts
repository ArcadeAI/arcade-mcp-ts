/**
 * Session management layer.
 *
 * Adds initialization state tracking, server-initiated request wrapping,
 * per-session data storage, and notification broadcast on top of the
 * MCP SDK's built-in transport handling.
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  ClientCapabilities,
  CreateMessageRequest,
  CreateMessageResult,
  CreateMessageResultWithTools,
  ElicitRequestFormParams,
  ElicitRequestURLParams,
  ElicitResult,
  Implementation,
  ListRootsRequest,
  ServerNotification,
} from "@modelcontextprotocol/sdk/types.js";
import { ServerRequestError, SessionError } from "./exceptions.js";
import { createLogger } from "./logger.js";

const logger = createLogger("arcade-mcp-session");

// ── Initialization state machine ────────────────────────

export enum InitializationState {
  NOT_INITIALIZED = "NOT_INITIALIZED",
  INITIALIZING = "INITIALIZING",
  INITIALIZED = "INITIALIZED",
}

// ── RequestManager ──────────────────────────────────────

/**
 * Wraps the SDK Server's server-initiated request methods with
 * timeout handling and our error hierarchy.
 */
export class RequestManager {
  private _closed = false;

  get closed(): boolean {
    return this._closed;
  }

  private guardClosed(): void {
    if (this._closed) {
      throw new SessionError("Session is closed");
    }
  }

  private async executeRequest<T>(
    methodName: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    this.guardClosed();
    try {
      return await fn();
    } catch (err) {
      if (this._closed) throw new SessionError("Session closed during request");
      throw new ServerRequestError(`${methodName} request failed`, {
        cause: err instanceof Error ? err : undefined,
      });
    }
  }

  async createMessage(
    server: Server,
    params: CreateMessageRequest["params"],
    options?: RequestOptions,
  ): Promise<CreateMessageResult | CreateMessageResultWithTools> {
    return this.executeRequest("sampling/createMessage", () =>
      server.createMessage(params, options),
    );
  }

  async elicitInput(
    server: Server,
    params: ElicitRequestFormParams | ElicitRequestURLParams,
    options?: RequestOptions,
  ): Promise<ElicitResult> {
    return this.executeRequest("elicitation/create", () =>
      server.elicitInput(params, options),
    );
  }

  async listRoots(
    server: Server,
    params?: ListRootsRequest["params"],
    options?: RequestOptions,
  ): Promise<{ roots: Array<{ uri: string; name?: string }> }> {
    return this.executeRequest("roots/list", () =>
      server.listRoots(params, options),
    );
  }

  close(): void {
    this._closed = true;
  }
}

// ── NotificationManager ─────────────────────────────────

/**
 * Broadcasts server-initiated notifications to multiple sessions.
 * Swallows per-session failures so one broken connection doesn't
 * block others.
 */
export class NotificationManager {
  private _getSessionRegistry: () => ReadonlyMap<string, ServerSession>;

  constructor(getSessionRegistry: () => ReadonlyMap<string, ServerSession>) {
    this._getSessionRegistry = getSessionRegistry;
  }

  async broadcast(
    notification: ServerNotification,
    sessionIds?: string[],
  ): Promise<void> {
    const registry = this._getSessionRegistry();
    const targets = sessionIds
      ? sessionIds
          .map((id) => registry.get(id))
          .filter((s): s is ServerSession => s !== undefined)
      : [...registry.values()];

    await Promise.all(
      targets.map(async (session) => {
        try {
          await session.sendNotification(notification);
        } catch {
          logger.debug(
            { sessionId: session.sessionId },
            "Failed to send notification to session (swallowed)",
          );
        }
      }),
    );
  }

  private async notifyListChanged(
    entity: "tools" | "resources" | "prompts",
    sessionIds?: string[],
  ): Promise<void> {
    await this.broadcast(
      {
        method: `notifications/${entity}/list_changed`,
        params: {},
      } as ServerNotification,
      sessionIds,
    );
  }

  async notifyToolListChanged(sessionIds?: string[]): Promise<void> {
    return this.notifyListChanged("tools", sessionIds);
  }

  async notifyResourceListChanged(sessionIds?: string[]): Promise<void> {
    return this.notifyListChanged("resources", sessionIds);
  }

  async notifyPromptListChanged(sessionIds?: string[]): Promise<void> {
    return this.notifyListChanged("prompts", sessionIds);
  }
}

// ── ServerSession ───────────────────────────────────────

export interface ServerSessionOptions {
  sessionId: string;
  mcpServer: McpServer;
  requestTimeout?: number;
}

/**
 * Wraps a per-session McpServer with initialization state tracking,
 * server-initiated request methods, and session-scoped data storage.
 */
export class ServerSession {
  readonly sessionId: string;
  readonly mcpServer: McpServer;
  readonly requestManager: RequestManager;
  readonly createdAt: number;

  private _initializationState = InitializationState.NOT_INITIALIZED;
  private _clientCapabilities?: ClientCapabilities;
  private _clientInfo?: Implementation;
  private _data = new Map<string, unknown>();
  private _lastAccessedAt: number;
  private _defaultTimeout: number;

  constructor(options: ServerSessionOptions) {
    this.sessionId = options.sessionId;
    this.mcpServer = options.mcpServer;
    this.requestManager = new RequestManager();
    this._defaultTimeout = options.requestTimeout ?? 400_000;
    const now = Date.now();
    this.createdAt = now;
    this._lastAccessedAt = now;
  }

  // ── State machine ───────────────────────────────────

  get initializationState(): InitializationState {
    return this._initializationState;
  }

  get isInitialized(): boolean {
    return this._initializationState === InitializationState.INITIALIZED;
  }

  get clientCapabilities(): ClientCapabilities | undefined {
    return this._clientCapabilities;
  }

  get clientInfo(): Implementation | undefined {
    return this._clientInfo;
  }

  markInitializing(): void {
    if (this._initializationState !== InitializationState.NOT_INITIALIZED) {
      throw new SessionError(
        `Cannot transition to INITIALIZING from ${this._initializationState}`,
      );
    }
    this._initializationState = InitializationState.INITIALIZING;
  }

  markInitialized(
    clientCapabilities?: ClientCapabilities,
    clientInfo?: Implementation,
  ): void {
    if (this._initializationState !== InitializationState.INITIALIZING) {
      throw new SessionError(
        `Cannot transition to INITIALIZED from ${this._initializationState}`,
      );
    }
    this._clientCapabilities = clientCapabilities;
    this._clientInfo = clientInfo;
    this._initializationState = InitializationState.INITIALIZED;
  }

  // ── Server-initiated requests ───────────────────────

  private get server(): Server {
    return this.mcpServer.server;
  }

  private guardInitialized(method: string): void {
    if (!this.isInitialized) {
      throw new SessionError(
        `Cannot call ${method}: session is ${this._initializationState}`,
      );
    }
  }

  private defaultOptions(options?: RequestOptions): RequestOptions {
    return { timeout: this._defaultTimeout, ...options };
  }

  async createMessage(
    params: CreateMessageRequest["params"],
    options?: RequestOptions,
  ): Promise<CreateMessageResult | CreateMessageResultWithTools> {
    this.guardInitialized("createMessage");
    return this.requestManager.createMessage(
      this.server,
      params,
      this.defaultOptions(options),
    );
  }

  async elicitInput(
    params: ElicitRequestFormParams | ElicitRequestURLParams,
    options?: RequestOptions,
  ): Promise<ElicitResult> {
    this.guardInitialized("elicitInput");
    return this.requestManager.elicitInput(
      this.server,
      params,
      this.defaultOptions(options),
    );
  }

  async listRoots(
    params?: ListRootsRequest["params"],
    options?: RequestOptions,
  ): Promise<{ roots: Array<{ uri: string; name?: string }> }> {
    this.guardInitialized("listRoots");
    return this.requestManager.listRoots(
      this.server,
      params,
      this.defaultOptions(options),
    );
  }

  // ── Notifications ───────────────────────────────────

  async sendNotification(notification: ServerNotification): Promise<void> {
    await this.server.notification(notification);
  }

  // ── Session-scoped data ─────────────────────────────

  getData<T = unknown>(key: string): T | undefined {
    return this._data.get(key) as T | undefined;
  }

  setData(key: string, value: unknown): void {
    this._data.set(key, value);
  }

  deleteData(key: string): boolean {
    return this._data.delete(key);
  }

  // ── Lifecycle ───────────────────────────────────────

  get lastAccessedAt(): number {
    return this._lastAccessedAt;
  }

  touch(): void {
    this._lastAccessedAt = Date.now();
  }

  close(): void {
    this.requestManager.close();
    this._data.clear();
  }
}
