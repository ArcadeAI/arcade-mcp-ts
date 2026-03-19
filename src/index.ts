// ── Main API ─────────────────────────────────────────────

// ── Auth ─────────────────────────────────────────────────
export * as auth from "./auth/index.js";
export type { AuthProviderType, ToolAuthorization } from "./auth/types.js";
export { normalizeVersion, ToolCatalog, toToolDefinition } from "./catalog.js";
// ── CLI / Discovery ─────────────────────────────────────
export {
  type CLIArgs,
  discoverToolModules,
  isToolExport,
  loadToolModules,
  loadToolModulesWithCacheBusting,
  parseArgs,
} from "./cli.js";
export { Context, getCurrentContext, setCurrentContext } from "./context.js";
// ── Errors ───────────────────────────────────────────────
export {
  ContextRequiredToolError,
  ErrorKind,
  FatalToolError,
  RetryableToolError,
  ToolDefinitionError,
  ToolError,
  ToolExecutionError,
  ToolInputError,
  ToolInputSchemaError,
  ToolkitError,
  ToolkitLoadError,
  ToolOutputError,
  ToolOutputSchemaError,
  ToolResponseExtractionError,
  ToolSerializationError,
  UpstreamError,
  UpstreamRateLimitError,
} from "./errors.js";
// ── Evals ────────────────────────────────────────────────
export * from "./evals/index.js";
// ── Event Store ──────────────────────────────────────────
export {
  type EventId,
  type EventStore,
  InMemoryEventStore,
  type StreamId,
} from "./event-store.js";
// ── MCP Exceptions ──────────────────────────────────────
export {
  AuthorizationError,
  LifespanError,
  MCPContextError,
  MCPError,
  MCPRuntimeError,
  NotFoundError,
  PromptError,
  ProtocolError,
  RequestError,
  ResourceError,
  ResponseError,
  ServerError,
  ServerRequestError,
  SessionError,
  TransportError,
} from "./exceptions.js";
export {
  handleToolError,
  runTool,
  type ToolExecutionResult,
  validateInput,
} from "./executor.js";
// ── Logger ──────────────────────────────────────────────
export { createLogger, type LogFormat } from "./logger.js";
export {
  ComponentRegistry,
  PromptManager,
  type RegistrySubscriber,
  ResourceManager,
  type StoredPrompt,
  type StoredResource,
} from "./managers/index.js";
export { MCPApp } from "./mcp-app.js";
// ── Middleware ────────────────────────────────────────────
export {
  applyMiddleware,
  composeMiddleware,
  Middleware,
} from "./middleware/base.js";
export { ErrorHandlingMiddleware } from "./middleware/error-handling.js";
export { LoggingMiddleware } from "./middleware/logging.js";
// ── Resource Server ──────────────────────────────────────
export {
  type AccessTokenValidationOptions,
  AuthenticationError,
  type AuthorizationServerEntry,
  InvalidTokenError,
  ResourceServerValidator,
  TokenExpiredError,
} from "./resource-server/index.js";
export { JWTResourceServerValidator } from "./resource-server/jwt-validator.js";
export { ArcadeMCPServer } from "./server.js";
// ── Settings ─────────────────────────────────────────────
export { loadSettings, type MCPSettings } from "./settings.js";
// ── Telemetry ────────────────────────────────────────────
export { OTELHandler, type OTELHandlerOptions } from "./telemetry.js";
export {
  type DevReloadHandle,
  type DevReloadOptions,
  watchForChanges,
} from "./transports/dev-reload.js";
export {
  type HttpHandle,
  type HttpOptions,
  runHttp,
  startHttp,
} from "./transports/http.js";

// ── Transports ───────────────────────────────────────────
export { setupGracefulShutdown } from "./transports/shutdown.js";
export { runStdio } from "./transports/stdio.js";
// ── Types ────────────────────────────────────────────────
export type {
  CallNext,
  MaterializedTool,
  MCPAppOptions,
  MiddlewareContext,
  PromptArgument,
  PromptHandler,
  PromptOptions,
  ResourceHandler,
  ResourceOptions,
  ResourceOwner,
  ResourceServerValidatorInterface,
  ToolCallRequest,
  ToolCallResponse,
  ToolContext,
  ToolDefinition,
  ToolHandler,
  ToolkitInfo,
  ToolOptions,
  TransportOptions,
} from "./types.js";
// ── Worker ───────────────────────────────────────────────
export { createWorkerRoutes } from "./worker/routes.js";
