import type { ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import pino from "pino";
import type { ToolAuthorization } from "./auth/types.js";
import { AuthorizationError, NotFoundError } from "./exceptions.js";
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

const logger = pino({ name: "arcade-mcp", transport: undefined });

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

	constructor(
		extra: ServerExtra,
		options?: {
			requestId?: string;
			sessionId?: string;
			resourceOwner?: ResourceOwner;
			toolContext?: ToolContextData;
		},
	) {
		this._extra = extra;
		this._requestId = options?.requestId ?? crypto.randomUUID();
		this._sessionId = options?.sessionId;
		this._resourceOwner = options?.resourceOwner;
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
	async createMessage(_options: {
		messages: Array<{
			role: "user" | "assistant";
			content: { type: "text"; text: string };
		}>;
		systemPrompt?: string;
		temperature?: number;
		maxTokens?: number;
	}): Promise<unknown> {
		// Delegate to MCP sampling via session
		return undefined;
	}
}

/**
 * UI facade: context.ui.elicit()
 */
export class UI extends ContextComponent {
	async elicit(
		_message: string,
		_schema?: Record<string, unknown>,
	): Promise<unknown> {
		// Delegate to MCP elicitation via session
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
 * Notifications facade: context.notifications.send()
 */
export class Notifications extends ContextComponent {
	async send(notification: ServerNotification): Promise<void> {
		try {
			await this.ctx.extra.sendNotification?.(notification);
		} catch {
			// Best-effort notification delivery
		}
	}
}
