import type { z } from "zod";
import type { ToolAuthorization } from "./auth/types.js";

/**
 * Separator between toolkit name and tool name in fully-qualified names.
 */
export const TOOL_NAME_SEPARATOR = "_";

/**
 * Options passed to app.tool() for defining a tool.
 */
export interface ToolOptions<T extends z.ZodType = z.ZodType> {
	description: string;
	parameters: T;
	auth?: ToolAuthorization;
	secrets?: string[];
	metadata?: Record<string, unknown>;
}

/**
 * A tool handler function receives validated args and a Context.
 */
export type ToolHandler<T = unknown, R = unknown> = (
	args: T,
	context: ToolContext,
) => R | Promise<R>;

/**
 * Minimal tool context interface used by handler signatures.
 * The full Context class implements this.
 */
export interface ToolContext {
	getSecret(name: string): string;
	getAuthToken(): string;
	getAuthTokenOrEmpty(): string;
	readonly signal: AbortSignal;
	readonly sessionId?: string;
	readonly requestId: string;
}

/**
 * A materialized tool stored in the catalog — contains the handler,
 * schema, auth requirements, and metadata.
 */
export interface MaterializedTool {
	name: string;
	fullyQualifiedName: string;
	description: string;
	handler: ToolHandler;
	parameters: z.ZodType;
	auth?: ToolAuthorization;
	secrets?: string[];
	metadata?: Record<string, unknown>;
	toolkitName?: string;
	dateAdded: Date;
	dateUpdated: Date;
}

/**
 * Tool definition as exposed to MCP clients (wire format).
 */
export interface ToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	auth?: ToolAuthorization;
	secrets?: string[];
	metadata?: Record<string, unknown>;
	toolkit?: {
		name: string;
		version?: string;
		description?: string;
	};
}

/**
 * Result of tool execution from the worker.
 */
export interface ToolCallResponse {
	executionId: string;
	duration: number;
	finishedAt: string;
	success: boolean;
	output?: {
		value?: unknown;
		error?: string;
	};
}

/**
 * Request body for worker tool invocation.
 */
export interface ToolCallRequest {
	name: string;
	inputs?: Record<string, unknown>;
	userId?: string;
	context?: {
		authorization?: {
			token?: string;
			userInfo?: Record<string, unknown>;
		};
		secrets?: Array<{ key: string; value: string }>;
		metadata?: Array<{ key: string; value: string }>;
	};
}

/**
 * Transport configuration for app.run().
 */
export interface TransportOptions {
	transport?: "stdio" | "http";
	host?: string;
	port?: number;
}

/**
 * Options for creating an MCPApp.
 */
export interface MCPAppOptions {
	name: string;
	version?: string;
	title?: string;
	instructions?: string;
	logLevel?: string;
	middleware?: Middleware[];
	auth?: ResourceServerValidatorInterface;
}

/**
 * Minimal interface for resource server validators.
 */
export interface ResourceServerValidatorInterface {
	validateToken(token: string): Promise<ResourceOwner>;
	supportsOAuthDiscovery?(): boolean;
	getResourceMetadata?(): Record<string, unknown> | null;
}

/**
 * Represents an authenticated resource owner (user).
 */
export interface ResourceOwner {
	userId: string;
	clientId?: string;
	email?: string;
	claims: Record<string, unknown>;
}

/**
 * Middleware interface — imported here to avoid circular deps.
 */
export interface Middleware {
	onMessage?(context: MiddlewareContext, next: CallNext): Promise<unknown>;
	onRequest?(context: MiddlewareContext, next: CallNext): Promise<unknown>;
	onCallTool?(context: MiddlewareContext, next: CallNext): Promise<unknown>;
	onListTools?(context: MiddlewareContext, next: CallNext): Promise<unknown>;
}

/**
 * Context passed through middleware chain.
 */
export interface MiddlewareContext {
	method: string;
	params: unknown;
	source: "client" | "server";
	type: "request" | "notification";
	timestamp: Date;
	requestId?: string;
	sessionId?: string;
	metadata: Record<string, unknown>;
}

/**
 * Next function in middleware chain.
 */
export type CallNext = (context: MiddlewareContext) => Promise<unknown>;
