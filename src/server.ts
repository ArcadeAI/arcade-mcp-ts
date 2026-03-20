import Arcade from "@arcadeai/arcadejs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { SpanStatusCode } from "@opentelemetry/api";
import { z } from "zod";
import type { ToolAuthorization } from "./auth/types.js";
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
import {
  getValidAccessToken,
  loadArcadeCredentials,
  type MCPSettings,
} from "./settings.js";
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
  private arcadeClient?: Arcade;
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

  /**
   * Register all tools from the catalog with the underlying McpServer.
   */
  registerCatalogTools(): void {
    for (const tool of this.catalog.getAll()) {
      this.registerToolOn(this.mcpServer, tool);
    }
  }

  /**
   * Register a single tool on the given McpServer target, wrapping the handler
   * to inject Context and apply middleware.
   */
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

    // Increment tool_call counter
    this.telemetry?.toolCallCounter?.add(1, spanAttributes);

    const tracer = this.telemetry?.enabled
      ? this.telemetry.getTracer("arcade-mcp-server")
      : undefined;

    const executeInner = async (): Promise<CallToolResult> => {
      // Build tool context with secrets
      const toolCtxData = this.buildToolContext(tool);

      // Resolve auth token from Arcade Cloud for tools with auth requirements.
      // Skipped when a token is already present (e.g. injected by worker routes).
      if (tool.auth && !toolCtxData.authToken) {
        _logger.debug(
          `Tool "${tool.fullyQualifiedName}" requires auth (provider=${tool.auth.providerId}), resolving token...`,
        );
        const authResult = await this.resolveAuthToken(
          tool.auth,
          toolCtxData.userId,
        );
        if (authResult.error) {
          _logger.debug(
            `Auth resolution for "${tool.fullyQualifiedName}" returned error to client`,
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

      // Resolve ServerSession for this request (if registered)
      const serverSession = extra.sessionId
        ? this._sessionRegistry.get(extra.sessionId)
        : undefined;

      // Build Context
      const context = new Context(extra, {
        requestId: String(extra.requestId ?? crypto.randomUUID()),
        sessionId: extra.sessionId,
        resourceOwner: this.extractResourceOwner(extra),
        toolContext: toolCtxData,
        serverSession,
      });

      // Set as current context
      const prevCtx = setCurrentContext(context);

      try {
        // Build middleware context
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

        // The final handler that actually runs the tool
        const finalHandler: CallNext = async () => {
          const result = await runTool(tool, args, context);

          if (result.success) {
            return toCallToolResult(result.value);
          }

          // Tool execution failed
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

        // Apply middleware chain
        if (this.middlewareChain.length > 0) {
          const wrappedHandler = applyMiddleware(
            this.middlewareChain as never[],
            finalHandler,
          );
          const result = await wrappedHandler(mwContext);
          return result as CallToolResult;
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

  /**
   * Build ToolContextData for a tool, injecting secrets from env/settings.
   */
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

  /**
   * Select user ID with priority: resource owner > settings > env > session.
   */
  private selectUserId(): string | undefined {
    const userId = this.settings?.arcade.userId ?? process.env.ARCADE_USER_ID;
    if (userId) {
      const source = this.settings?.arcade.userId
        ? process.env.ARCADE_USER_ID
          ? "ARCADE_USER_ID env var"
          : "~/.arcade/credentials.yaml"
        : "ARCADE_USER_ID env var";
      _logger.debug(`Resolved userId: ${userId} (source: ${source})`);
    } else {
      _logger.debug(
        "No userId resolved (checked ARCADE_USER_ID env var and ~/.arcade/credentials.yaml)",
      );
    }
    return userId;
  }

  /**
   * Extract ResourceOwner from the request extra (set by auth middleware).
   */
  private extractResourceOwner(extra: ServerExtra): ResourceOwner | undefined {
    const authInfo = extra.authInfo;
    if (!authInfo) return undefined;

    // authInfo may contain resource owner data set by our HTTP middleware
    if (
      typeof authInfo === "object" &&
      "userId" in (authInfo as Record<string, unknown>)
    ) {
      return authInfo as unknown as ResourceOwner;
    }

    return undefined;
  }

  /**
   * Get or create the Arcade Cloud client. Returns undefined if no API key is configured.
   * Handles token refresh for expired credentials and org/project URL rewriting
   * for non-service keys (JWTs from `arcade login`).
   */
  private async getArcadeClient(): Promise<Arcade | undefined> {
    if (this.arcadeClient) return this.arcadeClient;

    const arcade = this.settings?.arcade;
    let apiKey = arcade?.apiKey;

    if (!apiKey) {
      _logger.debug(
        "No Arcade API key found (checked ARCADE_API_KEY env var and ~/.arcade/credentials.yaml)",
      );
      return undefined;
    }

    // For non-service keys (JWTs from credentials.yaml), check expiry and refresh
    const isServiceKey = apiKey.startsWith("arc_");
    if (!isServiceKey && arcade) {
      const creds = loadArcadeCredentials();
      const result = await getValidAccessToken({
        apiKey,
        refreshToken: arcade.refreshToken ?? creds.refreshToken,
        expiresAt: arcade.expiresAt ?? creds.expiresAt,
        coordinatorUrl: arcade.coordinatorUrl ?? creds.coordinatorUrl,
      });
      if (result) {
        apiKey = result.apiKey;
        arcade.apiKey = apiKey;
      } else if (arcade.expiresAt || creds.expiresAt) {
        // Token was expired and refresh failed
        _logger.warn(
          "Arcade access token is expired and refresh failed. Run `arcade login` to re-authenticate.",
        );
        return undefined;
      }
    }

    const masked =
      apiKey.length > 12
        ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`
        : "***";
    const source = process.env.ARCADE_API_KEY
      ? "ARCADE_API_KEY env var"
      : "~/.arcade/credentials.yaml";
    _logger.debug(
      `Creating Arcade client (key: ${masked}, source: ${source}, baseURL: ${arcade?.apiUrl})`,
    );

    const clientOpts: ConstructorParameters<typeof Arcade>[0] = {
      apiKey,
      baseURL: arcade?.apiUrl,
    };

    // Non-service keys need org/project URL rewriting
    if (!isServiceKey && arcade?.orgId && arcade?.projectId) {
      const orgId = arcade.orgId;
      const projectId = arcade.projectId;
      const nativeFetch = globalThis.fetch;
      clientOpts.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        if (typeof input === "string" || input instanceof URL) {
          const url = new URL(input.toString());
          if (
            url.pathname.startsWith("/v1/") &&
            !url.pathname.includes("/v1/orgs/")
          ) {
            url.pathname = url.pathname.replace(
              "/v1/",
              `/v1/orgs/${orgId}/projects/${projectId}/`,
            );
          }
          return nativeFetch(url.toString(), init);
        }
        return nativeFetch(input, init);
      };
      _logger.info(
        `Configured org-scoped Arcade client for org '${orgId}' project '${projectId}'`,
      );
    } else if (!isServiceKey) {
      _logger.warn(
        "Expected to find org/project context in ~/.arcade/credentials.yaml but none was found; " +
          "using non-scoped Arcade client.",
      );
    }

    this.arcadeClient = new Arcade(clientOpts);
    return this.arcadeClient;
  }

  /**
   * Resolve an auth token from Arcade Cloud for a tool with an auth requirement.
   * Returns the token on success, or a CallToolResult error to return to the client.
   */
  private async resolveAuthToken(
    toolAuth: ToolAuthorization,
    userId: string | undefined,
  ): Promise<{ token?: string; error?: CallToolResult }> {
    if (this.settings?.arcade.authDisabled) {
      _logger.debug("Auth resolution skipped: ARCADE_AUTH_DISABLED is set");
      return {};
    }

    const client = await this.getArcadeClient();
    if (!client) {
      _logger.warn(
        "Tool requires auth but no Arcade API key is configured. " +
          "Set ARCADE_API_KEY env var or ensure ~/.arcade/credentials.yaml has a valid access_token.",
      );
      return {
        error: {
          content: [
            {
              type: "text" as const,
              text:
                "Tool requires authentication but no Arcade API key is configured. " +
                "Set the ARCADE_API_KEY environment variable or run `arcade login`.",
            },
          ],
          isError: true,
        },
      };
    }

    if (!userId) {
      _logger.warn("Tool requires auth but no userId is available");
      return {
        error: {
          content: [
            {
              type: "text" as const,
              text:
                "This tool requires authentication but no user ID is available. " +
                "Set the ARCADE_USER_ID environment variable or run `arcade login`.",
            },
          ],
          isError: true,
        },
      };
    }

    const authRequest = {
      user_id: userId,
      auth_requirement: {
        provider_id: toolAuth.providerId,
        provider_type: toolAuth.providerType,
        oauth2: { scopes: toolAuth.scopes ?? [] },
      },
    };
    _logger.debug(
      `Requesting auth token from Arcade Cloud: provider=${toolAuth.providerId}, type=${toolAuth.providerType}, userId=${userId}, scopes=${toolAuth.scopes?.join(",") ?? "none"}`,
    );

    let response: Awaited<ReturnType<typeof client.auth.authorize>>;
    try {
      response = await client.auth.authorize(authRequest);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = (err as { status?: number }).status;
      _logger.error(
        `Arcade Cloud auth request failed: ${message}${status ? ` (HTTP ${status})` : ""}`,
      );
      return {
        error: {
          content: [
            {
              type: "text" as const,
              text:
                `Arcade Cloud auth request failed${status ? ` (HTTP ${status})` : ""}: ${message}\n\n` +
                "Check that ARCADE_API_KEY is valid and not expired. " +
                "If using ~/.arcade/credentials.yaml, the access_token may need refreshing via `arcade login`.",
            },
          ],
          isError: true,
        },
      };
    }

    _logger.debug(
      `Arcade Cloud auth response: status=${response.status}, hasToken=${!!response.context?.token}, hasUrl=${!!response.url}`,
    );

    if (response.status === "completed") {
      return { token: response.context?.token ?? undefined };
    }

    if (response.status === "pending" || response.status === "not_started") {
      const message = response.url
        ? `Authorization required. Please visit the following URL to authorize, then retry:\n\n${response.url}`
        : "Authorization is pending. Please complete the authorization flow, then retry.";
      return {
        error: {
          content: [{ type: "text" as const, text: message }],
          isError: true,
        },
      };
    }

    // status === "failed" or unknown
    _logger.warn(
      `Authorization failed for provider "${toolAuth.providerId}": status=${response.status}`,
    );
    return {
      error: {
        content: [
          {
            type: "text" as const,
            text: `Authorization failed for provider "${toolAuth.providerId}" (status: ${response.status}). Please try again.`,
          },
        ],
        isError: true,
      },
    };
  }

  // ── Runtime tool management ──────────────────────────────

  /**
   * Add a tool at runtime.
   */
  addTool(tool: MaterializedTool): void {
    this.registerToolOn(this.mcpServer, tool);
  }

  // ── Prompt registration ──────────────────────────────────

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
   * Register a single prompt on the given McpServer target.
   */
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
    // Build Zod shape for argsSchema (SDK requires Zod types, not plain objects)
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

  /**
   * Add a prompt at runtime.
   */
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

  // ── Resource registration ────────────────────────────────

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

  /**
   * Register a single resource on the given McpServer target.
   */
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
   * Add a resource at runtime.
   */
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

  /**
   * Get the underlying McpServer for transport connection.
   * Suitable for single-session transports (e.g. stdio).
   */
  getServer(): McpServer {
    return this.mcpServer;
  }

  /**
   * Create a fresh McpServer instance with all registered tools, prompts,
   * and resources. Each call returns an independent Protocol chain, so
   * multiple HTTP sessions can run concurrently without hitting the SDK's
   * "Already connected to a transport" guard.
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

    for (const tool of this.catalog.getAll()) {
      this.registerToolOn(session, tool);
    }

    if (this.promptManager) {
      for (const prompt of this.promptManager.listPrompts()) {
        this.registerPromptOn(session, prompt.name, prompt);
      }
    }

    if (this.resourceManager) {
      for (const resource of this.resourceManager.listResources()) {
        this.registerResourceOn(session, resource.uri, resource.name, resource);
      }
    }

    return session;
  }

  /**
   * Get the catalog.
   */
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
  // Already a CallToolResult
  if (
    value !== null &&
    typeof value === "object" &&
    "content" in (value as Record<string, unknown>)
  ) {
    return value as CallToolResult;
  }

  // String -> text content
  if (typeof value === "string") {
    return {
      content: [{ type: "text", text: value }],
    };
  }

  // Object/Array -> JSON text content
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

  // Null/undefined
  return {
    content: [{ type: "text", text: "" }],
  };
}
