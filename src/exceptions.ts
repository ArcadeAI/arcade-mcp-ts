/**
 * MCP-level exception hierarchy.
 *
 * These are server/infrastructure errors (sessions, transports, protocol),
 * separate from the tool-execution errors in errors.ts.
 */

export interface MCPErrorOptions {
	cause?: Error;
}

/**
 * Base class for all MCP-level errors.
 */
export abstract class MCPError extends Error {
	constructor(message: string, options?: MCPErrorOptions) {
		super(message, { cause: options?.cause });
		this.name = this.constructor.name;
	}

	get isMCPError(): boolean {
		return true;
	}
}

// ── MCPRuntimeError branch ──────────────────────────────

/** Runtime errors in MCP processing. */
export class MCPRuntimeError extends MCPError {}

/** Server-level errors (not tool-related). */
export class ServerError extends MCPRuntimeError {}

/** Session lifecycle errors (timeout, invalid state). */
export class SessionError extends ServerError {}

/** Malformed or invalid requests from client to server. */
export class RequestError extends ServerError {}

/** Server-initiated request failures (server → client). */
export class ServerRequestError extends RequestError {}

/** Response construction/sending failures. */
export class ResponseError extends ServerError {}

/** Startup/shutdown lifecycle errors. */
export class LifespanError extends ServerError {}

/** Transport layer errors (stdio, HTTP, etc.). */
export class TransportError extends MCPRuntimeError {}

/** MCP protocol violations. */
export class ProtocolError extends MCPRuntimeError {}

// ── MCPContextError branch ──────────────────────────────

/** Context creation/access errors. */
export class MCPContextError extends MCPError {}

/** Requested entity not found. */
export class NotFoundError extends MCPContextError {}

/** Authorization/permission failures. */
export class AuthorizationError extends MCPContextError {}

/** Prompt-specific errors. */
export class PromptError extends MCPContextError {}

/** Resource-specific errors. */
export class ResourceError extends MCPContextError {}
