import type {
  GetPromptResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { ToolAuthorization } from "./auth/types.js";
import type { EventStore } from "./event-store.js";

/**
 * Separator between toolkit name and tool name in fully-qualified names.
 */
export const TOOL_NAME_SEPARATOR = "_";

/**
 * Toolkit identity — name, optional version, and optional description.
 */
export interface ToolkitInfo {
  name: string;
  version?: string;
  description?: string;
}

/**
 * Behavioral hints for a tool — mapped to MCP ToolAnnotations.
 */
export interface ToolBehavior {
  readOnly?: boolean;
  destructive?: boolean;
  idempotent?: boolean;
  openWorld?: boolean;
}

/**
 * Options passed to app.tool() for defining a tool.
 */
export interface ToolOptions<T extends z.ZodType = z.ZodType> {
  description: string;
  parameters: T;
  auth?: ToolAuthorization;
  secrets?: string[];
  metadata?: Record<string, unknown>;
  toolkit?: Partial<ToolkitInfo>;
  /** Human-readable display name for the tool. */
  title?: string;
  /** Message shown when the tool is deprecated. */
  deprecationMessage?: string;
  /** Behavioral hints mapped to MCP ToolAnnotations. */
  behavior?: ToolBehavior;
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
  toolkitVersion?: string;
  toolkitDescription?: string;
  /** Human-readable display name for the tool. */
  title?: string;
  /** Message shown when the tool is deprecated. */
  deprecationMessage?: string;
  /** Behavioral hints mapped to MCP ToolAnnotations. */
  behavior?: ToolBehavior;
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
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  _meta?: Record<string, unknown>;
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

// ── Prompt types ─────────────────────────────────────────

/**
 * A prompt argument definition.
 */
export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

/**
 * Options passed to app.prompt() for defining a prompt.
 */
export interface PromptOptions {
  description?: string;
  arguments?: PromptArgument[];
}

/**
 * A prompt handler function receives string arguments and returns prompt messages.
 */
export type PromptHandler = (
  args: Record<string, string>,
) => GetPromptResult | Promise<GetPromptResult>;

// ── Resource types ───────────────────────────────────────

/**
 * Options passed to app.resource() for defining a resource.
 */
export interface ResourceOptions {
  description?: string;
  mimeType?: string;
}

/**
 * A resource handler function receives a URI and returns resource contents.
 */
export type ResourceHandler = (
  uri: URL,
) => ReadResourceResult | Promise<ReadResourceResult>;

/**
 * Transport configuration for app.run().
 */
export interface TransportOptions {
  transport?: "stdio" | "http";
  host?: string;
  port?: number;
  dev?: boolean;
  eventStore?: EventStore;
  /** If true, create a fresh transport per request with no session reuse. */
  stateless?: boolean;
  /** Sliding-window TTL in ms per session. Undefined = no eviction. */
  sessionTtlMs?: number;
  /** Max concurrent sessions. Undefined = unlimited. */
  maxSessions?: number;
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
