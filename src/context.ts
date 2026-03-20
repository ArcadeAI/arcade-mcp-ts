import type { ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import type { ToolAuthorization } from "./auth/types.js";
import { AuthorizationError, NotFoundError } from "./exceptions.js";
import { createLogger } from "./logger.js";
import type { ServerSession } from "./session.js";
import type { ResourceOwner } from "./types.js";

/**
 * The RequestHandlerExtra type from MCP SDK, parameterized for server usage.
 */
// biome-ignore lint/suspicious/noExplicitAny: SDK generic requires flexible typing
export type ServerExtra = Record<string, any> & {
  signal: AbortSignal;
  authInfo?: unknown;
  sessionId?: string;
  requestId?: string | number;
  sendNotification?: (notification: ServerNotification) => Promise<void>;
  sendRequest?: (...args: unknown[]) => Promise<unknown>;
};

const logger = createLogger("arcade-mcp");

/**
 * Current context for the active request — enables get_current_context() pattern.
 */
let _currentContext: Context | null = null;

export function getCurrentContext(): Context | null {
  return _currentContext;
}

export function setCurrentContext(ctx: Context | null): Context | null {
  const prev = _currentContext;
  _currentContext = ctx;
  return prev;
}

/**
 * Tool context carrying auth, secrets, and user info for a single tool execution.
 */
export interface ToolContextData {
  authorization?: ToolAuthorization;
  authToken?: string;
  secrets: Record<string, string>;
  metadata: Record<string, unknown>;
  userId?: string;
}

/**
 * Context wraps MCP SDK's RequestHandlerExtra and adds Arcade features.
 * Tool handlers receive (args, context: Context).
 */
export class Context {
  readonly log: Logs;
  readonly progress: Progress;
  readonly resources: Resources;
  readonly tools: Tools;
  readonly sampling: Sampling;
  readonly ui: UI;
  readonly prompts: Prompts;
  readonly notifications: Notifications;

  private _extra: ServerExtra;
  private _toolContext: ToolContextData;
  private _resourceOwner?: ResourceOwner;
  private _requestId: string;
  private _sessionId?: string;
  private _serverSession?: ServerSession;

  constructor(
    extra: ServerExtra,
    options?: {
      requestId?: string;
      sessionId?: string;
      resourceOwner?: ResourceOwner;
      toolContext?: ToolContextData;
      serverSession?: ServerSession;
    },
  ) {
    this._extra = extra;
    this._requestId = options?.requestId ?? crypto.randomUUID();
    this._sessionId = options?.sessionId;
    this._resourceOwner = options?.resourceOwner;
    this._serverSession = options?.serverSession;
    this._toolContext = options?.toolContext ?? {
      secrets: {},
      metadata: {},
    };

    // Initialize facades
    this.log = new Logs(this);
    this.progress = new Progress(this);
    this.resources = new Resources(this);
    this.tools = new Tools(this);
    this.sampling = new Sampling(this);
    this.ui = new UI(this);
    this.prompts = new Prompts(this);
    this.notifications = new Notifications(this);
  }

  get signal(): AbortSignal {
    return this._extra.signal;
  }

  get sessionId(): string | undefined {
    return this._sessionId;
  }

  get requestId(): string {
    return this._requestId;
  }

  get resourceOwner(): ResourceOwner | undefined {
    return this._resourceOwner;
  }

  get userId(): string | undefined {
    return this._resourceOwner?.userId ?? this._toolContext.userId;
  }

  get extra(): ServerExtra {
    return this._extra;
  }

  get serverSession(): ServerSession | undefined {
    return this._serverSession;
  }

  /**
   * Get a secret by name. Throws if missing.
   */
  getSecret(name: string): string {
    const value = this._toolContext.secrets[name];
    if (value === undefined) {
      throw new NotFoundError(`Secret '${name}' not found in context`);
    }
    return value;
  }

  /**
   * Get the auth token. Throws if missing.
   */
  getAuthToken(): string {
    const token = this._toolContext.authToken;
    if (!token) {
      throw new AuthorizationError("Auth token not found in context");
    }
    return token;
  }

  /**
   * Get the auth token, returning empty string if missing.
   */
  getAuthTokenOrEmpty(): string {
    return this._toolContext.authToken ?? "";
  }

  /**
   * Set tool-specific context (auth, secrets, etc).
   */
  setToolContext(data: ToolContextData): void {
    this._toolContext = data;
  }

  /**
   * Get current tool context data (for save/restore).
   */
  getToolContext(): ToolContextData {
    return { ...this._toolContext };
  }

  /**
   * Send a notification via the MCP session.
   * @deprecated Use context.notifications.send() instead.
   */
  async sendNotification(notification: ServerNotification): Promise<void> {
    await this.notifications.send(notification);
  }
}

/**
 * Base class for context facades.
 */
class ContextComponent {
  constructor(protected ctx: Context) {}
}

/**
 * Logging facade: context.log.info(), .debug(), .warning(), .error()
 */
export class Logs extends ContextComponent {
  info(message: string, extra?: Record<string, unknown>): void {
    logger.info({ requestId: this.ctx.requestId, ...extra }, message);
  }

  debug(message: string, extra?: Record<string, unknown>): void {
    logger.debug({ requestId: this.ctx.requestId, ...extra }, message);
  }

  warning(message: string, extra?: Record<string, unknown>): void {
    logger.warn({ requestId: this.ctx.requestId, ...extra }, message);
  }

  error(message: string, extra?: Record<string, unknown>): void {
    logger.error({ requestId: this.ctx.requestId, ...extra }, message);
  }
}

/**
 * Progress reporting facade: context.progress.report()
 */
export class Progress extends ContextComponent {
  async report(
    progress: number,
    total?: number,
    message?: string,
  ): Promise<void> {
    // Send progress notification via MCP protocol
    try {
      await this.ctx.extra.sendNotification?.({
        method: "notifications/progress" as never,
        params: {
          progress,
          total,
          message,
        } as never,
      });
    } catch {
      // Best-effort progress reporting
    }
  }
}

/**
 * Resource access facade: context.resources.read(), .list()
 */
export class Resources extends ContextComponent {
  async read(_uri: string): Promise<unknown> {
    // Delegate to server's resource handler via extra
    return undefined;
  }

  async list(): Promise<unknown[]> {
    return [];
  }
}

/**
 * Tool calling facade: context.tools.call(), .list()
 */
export class Tools extends ContextComponent {
  async call(
    _name: string,
    _params?: Record<string, unknown>,
  ): Promise<unknown> {
    // Delegate to server's tool executor
    return undefined;
  }

  async list(): Promise<unknown[]> {
    return [];
  }
}

/**
 * Sampling facade: context.sampling.createMessage()
 */
export class Sampling extends ContextComponent {
  async createMessage(options: {
    messages: Array<{
      role: "user" | "assistant";
      content: { type: "text"; text: string };
    }>;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<unknown> {
    const session = this.ctx.serverSession;
    if (session?.isInitialized) {
      return session.createMessage({
        messages: options.messages,
        systemPrompt: options.systemPrompt,
        temperature: options.temperature,
        maxTokens: options.maxTokens ?? 1024,
      });
    }
    return undefined;
  }
}

/**
 * UI facade: context.ui.elicit()
 */
export class UI extends ContextComponent {
  async elicit(
    message: string,
    schema?: Record<string, unknown>,
  ): Promise<unknown> {
    const session = this.ctx.serverSession;
    if (session?.isInitialized) {
      return session.elicitInput({
        message,
        requestedSchema: schema,
      } as never);
    }
    return undefined;
  }
}

/**
 * Prompts facade: context.prompts.get(), .list()
 */
export class Prompts extends ContextComponent {
  async get(
    _name: string,
    _arguments?: Record<string, string>,
  ): Promise<unknown> {
    // Delegate to server's prompt handler via extra
    return undefined;
  }

  async list(): Promise<unknown[]> {
    return [];
  }
}

/**
 * Sub-facade for entity-specific list change notifications.
 */
class _NotificationSubFacade {
  constructor(
    private parent: Notifications,
    private method: string,
  ) {}

  async listChanged(): Promise<void> {
    this.parent.enqueue(this.method);
  }
}

/**
 * Notifications facade: context.notifications.send()
 *
 * Provides typed sub-facades for common notification types:
 * - context.notifications.tools.listChanged()
 * - context.notifications.resources.listChanged()
 * - context.notifications.prompts.listChanged()
 *
 * Notifications are deduplicated and flushed in batch at end of request.
 */
export class Notifications extends ContextComponent {
  readonly tools: _NotificationSubFacade;
  readonly resources: _NotificationSubFacade;
  readonly prompts: _NotificationSubFacade;

  private _queue = new Set<string>();

  constructor(ctx: Context) {
    super(ctx);
    this.tools = new _NotificationSubFacade(
      this,
      "notifications/tools/list_changed",
    );
    this.resources = new _NotificationSubFacade(
      this,
      "notifications/resources/list_changed",
    );
    this.prompts = new _NotificationSubFacade(
      this,
      "notifications/prompts/list_changed",
    );
  }

  /**
   * Send an arbitrary notification immediately (not queued).
   */
  async send(notification: ServerNotification): Promise<void> {
    try {
      await this.ctx.extra.sendNotification?.(notification);
    } catch {
      // Best-effort notification delivery
    }
  }

  /**
   * Enqueue a notification method for batched, deduplicated delivery.
   * @internal
   */
  enqueue(method: string): void {
    this._queue.add(method);
  }

  /**
   * Flush all queued notifications. Called automatically at end of request.
   * Safe to call multiple times — second call is a no-op if queue is empty.
   */
  async flush(): Promise<void> {
    if (this._queue.size === 0) return;

    const methods = [...this._queue];
    this._queue.clear();

    for (const method of methods) {
      try {
        await this.ctx.extra.sendNotification?.({
          method,
          params: {},
        } as ServerNotification);
      } catch {
        // Best-effort — don't let notification failures break the request
      }
    }
  }
}
