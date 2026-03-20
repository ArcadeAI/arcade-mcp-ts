import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { SpanStatusCode } from "@opentelemetry/api";
import { z } from "zod";
import { ArcadeAuthResolver } from "./auth-resolution.js";
import type { ToolCatalog } from "./catalog.js";
import {
  Context,
  type ServerExtra,
  setCurrentContext,
  type ToolContextData,
} from "./context.js";
import { createMcpToolConfig } from "./convert.js";
import { runTool } from "./executor.js";
import { createLogger } from "./logger.js";
import type { PromptManager } from "./managers/prompt-manager.js";
import type { ResourceManager } from "./managers/resource-manager.js";
import { applyMiddleware } from "./middleware/base.js";
import { ErrorHandlingMiddleware } from "./middleware/error-handling.js";
import { LoggingMiddleware } from "./middleware/logging.js";
import { NotificationManager, type ServerSession } from "./session.js";
import type { MCPSettings } from "./settings.js";
import type { OTELHandler } from "./telemetry.js";
import type {
  CallNext,
  MaterializedTool,
  MiddlewareContext,
  Middleware as MiddlewareInterface,
  PromptHandler,
  PromptOptions,
  ResourceHandler,
  ResourceOptions,
  ResourceOwner,
  ResourceServerValidatorInterface,
} from "./types.js";
import type { ServerTracker } from "./usage/index.js";

const _logger = createLogger("arcade-mcp-server");

export interface ArcadeMCPServerOptions {
  name: string;
  version: string;
  title?: string;
  instructions?: string;
  settings?: MCPSettings;
  middleware?: MiddlewareInterface[];
  auth?: ResourceServerValidatorInterface;
  telemetry?: OTELHandler;
  tracker?: ServerTracker;
  promptManager?: PromptManager;
  resourceManager?: ResourceManager;
}

/**
 * ArcadeMCPServer wraps the SDK's McpServer, intercepting tool registration
 * to add context injection, secret management, and middleware.
 */
export class ArcadeMCPServer {
  readonly mcpServer: McpServer;
  private catalog: ToolCatalog;
  private settings?: MCPSettings;
  private middlewareChain: MiddlewareInterface[];
  private auth?: ResourceServerValidatorInterface;
  private telemetry?: OTELHandler;
  private tracker?: ServerTracker;
  private promptManager?: PromptManager;
  private resourceManager?: ResourceManager;
  private name: string;
  private version: string;
  private authResolver: ArcadeAuthResolver;
  private _sessionRegistry = new Map<string, ServerSession>();
  private _notificationManager?: NotificationManager;

  constructor(catalog: ToolCatalog, options: ArcadeMCPServerOptions) {
    this.catalog = catalog;
    this.name = options.name;
    this.version = options.version;
    this.settings = options.settings;
    this.auth = options.auth;
    this.telemetry = options.telemetry;
    this.tracker = options.tracker;
    this.promptManager = options.promptManager;
    this.resourceManager = options.resourceManager;
    this.authResolver = new ArcadeAuthResolver(options.settings?.arcade);

    // Build middleware chain
    this.middlewareChain = [];
    if (options.settings?.middleware.enableErrorHandling !== false) {
      this.middlewareChain.push(
        new ErrorHandlingMiddleware(
          options.settings?.middleware.maskErrorDetails,
        ) as unknown as MiddlewareInterface,
      );
    }
    if (options.settings?.middleware.enableLogging !== false) {
      this.middlewareChain.push(
        new LoggingMiddleware(
          options.settings?.middleware.logLevel,
        ) as unknown as MiddlewareInterface,
      );
    }
    if (options.middleware) {
      this.middlewareChain.push(...options.middleware);
    }

    // Create the underlying McpServer
    this.mcpServer = new McpServer(
      { name: options.name, version: options.version },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
          logging: {},
        },
        instructions: options.instructions,
      },
    );
  }

  // ── Catalog registration ────────────────────────────────

  /**
   * Register all tools from the catalog with the underlying McpServer.
   */
  registerCatalogTools(): void {
    for (const tool of this.catalog.getAll()) {
      this.registerToolOn(this.mcpServer, tool);
    }
  }

  /**
   * Register all prompts from the prompt manager with the underlying McpServer.
   */
  registerCatalogPrompts(): void {
    if (!this.promptManager) return;
    for (const prompt of this.promptManager.listPrompts()) {
      this.registerPromptOn(this.mcpServer, prompt.name, prompt);
    }
  }

  /**
   * Register all resources from the resource manager with the underlying McpServer.
   */
  registerCatalogResources(): void {
    if (!this.resourceManager) return;
    for (const resource of this.resourceManager.listResources()) {
      this.registerResourceOn(
        this.mcpServer,
        resource.uri,
        resource.name,
        resource,
      );
    }
  }

  // ── Single-item registration on a target McpServer ──────

  private registerToolOn(target: McpServer, tool: MaterializedTool): void {
    const config = createMcpToolConfig(tool);
    target.registerTool(
      tool.fullyQualifiedName,
      {
        title: config.title,
        description: config.description,
        inputSchema: tool.parameters as never,
        annotations: config.annotations,
        _meta: config._meta,
      },
      (async (args: Record<string, unknown>, extra: ServerExtra) => {
        return this.executeTool(tool, args, extra);
      }) as never,
    );
  }

  private registerPromptOn(
    target: McpServer,
    name: string,
    stored: {
      description?: string;
      arguments?: Array<{
        name: string;
        description?: string;
        required?: boolean;
      }>;
    },
  ): void {
    const argsSchema: Record<string, z.ZodType> = {};
    if (stored.arguments) {
      for (const arg of stored.arguments) {
        const base = arg.description
          ? z.string().describe(arg.description)
          : z.string();
        argsSchema[arg.name] = arg.required ? base : base.optional();
      }
    }

    const config: Record<string, unknown> = {
      description: stored.description,
    };
    if (Object.keys(argsSchema).length > 0) {
      config.argsSchema = argsSchema;
    }

    target.registerPrompt(
      name,
      config as never,
      (async (args: Record<string, string>) => {
        return this.promptManager!.getPrompt(name, args);
      }) as never,
    );
  }

  private registerResourceOn(
    target: McpServer,
    uri: string,
    name: string,
    stored: { description?: string; mimeType?: string },
  ): void {
    target.registerResource(
      name,
      uri,
      { description: stored.description, mimeType: stored.mimeType } as never,
      (async (resourceUri: URL) => {
        return this.resourceManager!.readResource(resourceUri.href);
      }) as never,
    );
  }

  /**
   * Register all tools, prompts, and resources on a target McpServer.
   */
  private registerAllOn(target: McpServer): void {
    for (const tool of this.catalog.getAll()) {
      this.registerToolOn(target, tool);
    }

    if (this.promptManager) {
      for (const prompt of this.promptManager.listPrompts()) {
        this.registerPromptOn(target, prompt.name, prompt);
      }
    }

    if (this.resourceManager) {
      for (const resource of this.resourceManager.listResources()) {
        this.registerResourceOn(target, resource.uri, resource.name, resource);
      }
    }
  }

  // ── Runtime additions ───────────────────────────────────

  addTool(tool: MaterializedTool): void {
    this.registerToolOn(this.mcpServer, tool);
  }

  addPrompt(
    name: string,
    options: PromptOptions,
    _handler?: PromptHandler,
  ): void {
    this.registerPromptOn(this.mcpServer, name, {
      description: options.description,
      arguments: options.arguments,
    });
  }

  addResource(
    uri: string,
    name: string,
    options: ResourceOptions,
    _handler?: ResourceHandler,
  ): void {
    this.registerResourceOn(this.mcpServer, uri, name, {
      description: options.description,
      mimeType: options.mimeType,
    });
  }

  // ── Tool execution pipeline ─────────────────────────────

  /**
   * Execute a tool with context injection, secret management, and middleware.
   */
  private async executeTool(
    tool: MaterializedTool,
    args: Record<string, unknown>,
    extra: ServerExtra,
  ): Promise<CallToolResult> {
    const environment = this.settings?.arcade.environment ?? "dev";
    const spanAttributes = {
      tool_name: tool.fullyQualifiedName,
      toolkit_name: tool.name,
      environment,
    };

    this.telemetry?.toolCallCounter?.add(1, spanAttributes);

    const tracer = this.telemetry?.enabled
      ? this.telemetry.getTracer("arcade-mcp-server")
      : undefined;

    const executeInner = async (): Promise<CallToolResult> => {
      const toolCtxData = this.buildToolContext(tool);

      // Warn about missing secrets
      if (tool.secrets && tool.secrets.length > 0) {
        const missing = tool.secrets.filter((s) => !(s in toolCtxData.secrets));
        if (missing.length > 0) {
          _logger.warn(
            `Tool "${tool.fullyQualifiedName}" missing required secrets: [${missing.join(", ")}]`,
          );
        }
      }

      // Resolve auth token if needed
      if (tool.auth && !toolCtxData.authToken) {
        _logger.debug(
          `Tool "${tool.fullyQualifiedName}" requires auth (provider=${tool.auth.providerId}), resolving token...`,
        );
        const authResult = await this.authResolver.resolveAuthToken(
          tool.auth,
          toolCtxData.userId,
        );
        if (authResult.error) {
          _logger.warn(
            `Tool "${tool.fullyQualifiedName}" auth failed (provider=${tool.auth.providerId})`,
          );
          return authResult.error;
        }
        if (authResult.token) {
          _logger.debug(`Auth token resolved for "${tool.fullyQualifiedName}"`);
          toolCtxData.authToken = authResult.token;
        }
      } else if (tool.auth && toolCtxData.authToken) {
        _logger.debug(
          `Tool "${tool.fullyQualifiedName}" has pre-injected auth token, skipping resolution`,
        );
      }

      const serverSession = extra.sessionId
        ? this._sessionRegistry.get(extra.sessionId)
        : undefined;

      const context = new Context(extra, {
        requestId: String(extra.requestId ?? crypto.randomUUID()),
        sessionId: extra.sessionId,
        resourceOwner: this.extractResourceOwner(extra),
        toolContext: toolCtxData,
        serverSession,
      });

      const prevCtx = setCurrentContext(context);

      try {
        const mwContext: MiddlewareContext = {
          method: "tools/call",
          params: { name: tool.fullyQualifiedName, arguments: args },
          source: "client",
          type: "request",
          timestamp: new Date(),
          requestId: context.requestId,
          sessionId: context.sessionId,
          metadata: {},
        };

        const finalHandler: CallNext = async () => {
          const result = await runTool(tool, args, context);
          if (result.success) {
            return toCallToolResult(result.value);
          }
          return {
            content: [
              {
                type: "text" as const,
                text: result.error?.message ?? "Tool execution failed",
              },
            ],
            isError: true,
          };
        };

        if (this.middlewareChain.length > 0) {
          const wrappedHandler = applyMiddleware(
            this.middlewareChain as never[],
            finalHandler,
          );
          return (await wrappedHandler(mwContext)) as CallToolResult;
        }

        return (await finalHandler(mwContext)) as CallToolResult;
      } finally {
        await context.notifications.flush();
        setCurrentContext(prevCtx);
      }
    };

    const trackResult = (result: CallToolResult): void => {
      this.tracker?.trackToolCall({
        success: !result.isError,
        failureReason: result.isError
          ? "error during tool execution"
          : undefined,
      });
    };

    if (!tracer) {
      const result = await executeInner();
      trackResult(result);
      return result;
    }

    return tracer.startActiveSpan("RunTool", async (span) => {
      span.setAttributes(spanAttributes);
      try {
        const result = await executeInner();
        trackResult(result);
        return result;
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        if (err instanceof Error) {
          span.recordException(err);
        }
        throw err;
      } finally {
        span.end();
      }
    });
  }

  // ── Helpers ─────────────────────────────────────────────

  private buildToolContext(tool: MaterializedTool): ToolContextData {
    const secrets: Record<string, string> = {};

    if (tool.secrets) {
      const envSecrets = this.settings?.toolSecrets ?? {};
      for (const secretName of tool.secrets) {
        const value = envSecrets[secretName] ?? process.env[secretName];
        if (value !== undefined) {
          secrets[secretName] = value;
        }
      }
    }

    return {
      secrets,
      metadata: tool.metadata ?? {},
      userId: this.selectUserId(),
    };
  }

  private selectUserId(): string | undefined {
    const userId = this.settings?.arcade.userId ?? process.env.ARCADE_USER_ID;
    if (userId) {
      const source = process.env.ARCADE_USER_ID
        ? "ARCADE_USER_ID env var"
        : "~/.arcade/credentials.yaml";
      _logger.debug(`Resolved userId: ${userId} (source: ${source})`);
    } else {
      _logger.debug(
        "No userId resolved (checked ARCADE_USER_ID env var and ~/.arcade/credentials.yaml)",
      );
    }
    return userId;
  }

  private extractResourceOwner(extra: ServerExtra): ResourceOwner | undefined {
    const authInfo = extra.authInfo;
    if (!authInfo) return undefined;

    if (
      typeof authInfo === "object" &&
      "userId" in (authInfo as Record<string, unknown>)
    ) {
      return authInfo as unknown as ResourceOwner;
    }

    return undefined;
  }

  // ── Server access ───────────────────────────────────────

  getServer(): McpServer {
    return this.mcpServer;
  }

  /**
   * Create a fresh McpServer instance with all registered tools, prompts,
   * and resources for a new HTTP session.
   */
  createSessionServer(): McpServer {
    const session = new McpServer(
      { name: this.name, version: this.version },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
          logging: {},
        },
      },
    );

    this.registerAllOn(session);
    return session;
  }

  getCatalog(): ToolCatalog {
    return this.catalog;
  }

  // ── Session registry ───────────────────────────────────

  registerSession(id: string, session: ServerSession): void {
    this._sessionRegistry.set(id, session);
  }

  unregisterSession(id: string): void {
    this._sessionRegistry.delete(id);
  }

  get sessionRegistry(): ReadonlyMap<string, ServerSession> {
    return this._sessionRegistry;
  }

  get notificationManager(): NotificationManager {
    if (!this._notificationManager) {
      this._notificationManager = new NotificationManager(
        () => this._sessionRegistry,
      );
    }
    return this._notificationManager;
  }
}

/**
 * Convert a tool handler result to MCP CallToolResult format.
 */
function toCallToolResult(value: unknown): CallToolResult {
  if (
    value !== null &&
    typeof value === "object" &&
    "content" in (value as Record<string, unknown>)
  ) {
    return value as CallToolResult;
  }

  if (typeof value === "string") {
    return {
      content: [{ type: "text", text: value }],
    };
  }

  if (value !== null && value !== undefined) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(value, null, 2),
        },
      ],
    };
  }

  return {
    content: [{ type: "text", text: "" }],
  };
}
