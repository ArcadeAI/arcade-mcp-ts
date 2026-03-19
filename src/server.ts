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
  type ToolExecutor,
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
export class ArcadeMCPServer implements ToolExecutor {
  readonly mcpServer: McpServer;
  private catalog: ToolCatalog;
  private _settings?: MCPSettings;
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
    this._settings = options.settings;
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

  // ── ToolExecutor interface ───────────────────────────────

  async executeToolByName(
    name: string,
    args: Record<string, unknown>,
    extra: ServerExtra,
  ): Promise<CallToolResult> {
    const tool = this.catalog.getTool(name);
    if (!tool) {
      return {
        content: [{ type: "text" as const, text: `Tool '${name}' not found` }],
        isError: true,
      };
    }
    return this.executeTool(tool, args, extra);
  }

  getArcadeClient(): Arcade | undefined {
    return this._getArcadeClient();
  }

  getSettings(): MCPSettings | undefined {
    return this._settings;
  }

  hasToolInCatalog(name: string): boolean {
    return this.catalog.has(name);
  }

  // ── Tool registration ────────────────────────────────────

  /**
   * Register all tools from the catalog with the underlying McpServer.
   */
  registerCatalogTools(): void {
    for (const tool of this.catalog.getAll()) {
      this.registerTool(tool);
    }
  }

  /**
   * Register a single tool with the McpServer, wrapping the handler
   * to inject Context and apply middleware.
   */
  private registerTool(tool: MaterializedTool): void {
    const config = createMcpToolConfig(tool);
    this.mcpServer.registerTool(
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
    const environment = this._settings?.arcade.environment ?? "dev";
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

      // Determine which auth requirements to check
      const authReqs: ToolAuthorization[] = [];
      let isMultiProvider = false;

      if (
        tool.resolvedAuthorizations &&
        tool.resolvedAuthorizations.length > 0
      ) {
        authReqs.push(...tool.resolvedAuthorizations);
        isMultiProvider = tool.resolvedAuthorizations.length > 1;
      } else if (tool.auth) {
        authReqs.push(tool.auth);
      }

      // Resolve auth tokens
      if (authReqs.length > 0 && !toolCtxData.authToken) {
        for (const authReq of authReqs) {
          _logger.debug(
            `Tool "${tool.fullyQualifiedName}" requires auth (provider=${authReq.providerId}), resolving token...`,
          );
          const authResult = await this.resolveAuthToken(
            authReq,
            toolCtxData.userId,
          );
          if (authResult.error) {
            _logger.debug(
              `Auth resolution for "${tool.fullyQualifiedName}" (provider=${authReq.providerId}) returned error to client`,
            );
            return authResult.error;
          }
          // For single-provider tools, inject the token
          // Multi-provider tools handle auth via Arcade Cloud in sub-tool calls
          if (!isMultiProvider && authResult.token) {
            _logger.debug(
              `Auth token resolved for "${tool.fullyQualifiedName}"`,
            );
            toolCtxData.authToken = authResult.token;
          }
        }
      } else if (authReqs.length > 0 && toolCtxData.authToken) {
        _logger.debug(
          `Tool "${tool.fullyQualifiedName}" has pre-injected auth token, skipping resolution`,
        );
      }

      // Resolve ServerSession for this request (if registered)
      const serverSession = extra.sessionId
        ? this._sessionRegistry.get(extra.sessionId)
        : undefined;

      // Build Context with ToolExecutor reference
      const context = new Context(extra, {
        requestId: String(extra.requestId ?? crypto.randomUUID()),
        sessionId: extra.sessionId,
        resourceOwner: this.extractResourceOwner(extra),
        toolContext: toolCtxData,
        serverSession,
        toolExecutor: this,
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
      const envSecrets = this._settings?.toolSecrets ?? {};
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
    const userId = this._settings?.arcade.userId ?? process.env.ARCADE_USER_ID;
    if (userId) {
      const source = this._settings?.arcade.userId
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
   */
  private _getArcadeClient(): Arcade | undefined {
    if (this.arcadeClient) return this.arcadeClient;
    const apiKey = this._settings?.arcade.apiKey;
    if (!apiKey) {
      _logger.debug(
        "No Arcade API key found (checked ARCADE_API_KEY env var and ~/.arcade/credentials.yaml)",
      );
      return undefined;
    }
    const masked =
      apiKey.length > 12
        ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`
        : "***";
    const source = process.env.ARCADE_API_KEY
      ? "ARCADE_API_KEY env var"
      : "~/.arcade/credentials.yaml";
    _logger.debug(
      `Creating Arcade client (key: ${masked}, source: ${source}, baseURL: ${this._settings?.arcade.apiUrl})`,
    );
    this.arcadeClient = new Arcade({
      apiKey,
      baseURL: this._settings?.arcade.apiUrl,
    });
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
    if (this._settings?.arcade.authDisabled) {
      _logger.debug("Auth resolution skipped: ARCADE_AUTH_DISABLED is set");
      return {};
    }

    const client = this._getArcadeClient();
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
        oauth2: toolAuth.scopes ? { scopes: toolAuth.scopes } : undefined,
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
      const providerLabel = toolAuth.providerId ?? "unknown provider";
      const message = response.url
        ? `Authorization required for ${providerLabel}. Please visit the following URL to authorize, then retry:\n\n${response.url}`
        : `Authorization is pending for ${providerLabel}. Please complete the authorization flow, then retry.`;
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

  // ── Cross-tool requirement resolution ────────────────────

  /**
   * Fetch and merge requirements from remote tools referenced via
   * requiresSecretsFrom / requestScopesFrom.
   *
   * For each local tool that declares these fields, we call
   * arcade.tools.get(name) to fetch the remote tool's definition and
   * merge its secret/scope requirements into the local tool's requirements.
   * This runs before registerCatalogTools() so that the tool definitions
   * exposed to clients already reflect the merged requirements.
   */
  async resolveCrossToolRequirements(): Promise<void> {
    const client = this._getArcadeClient();

    // Check if any tools actually need resolution
    let needsResolution = false;
    for (const tool of this.catalog.getAll()) {
      if (tool.requiresSecretsFrom?.length || tool.requestScopesFrom?.length) {
        needsResolution = true;
        break;
      }
    }

    if (!needsResolution) return;

    if (!client) {
      _logger.warn(
        "Tools declare requiresSecretsFrom/requestScopesFrom but no " +
          "Arcade client is configured. Remote requirements will not be resolved. " +
          "Set ARCADE_API_KEY to enable remote requirement resolution.",
      );
      return;
    }

    // Collect all unique remote tool FQNs we need to look up
    const remoteFqns = new Set<string>();
    for (const tool of this.catalog.getAll()) {
      for (const fqn of tool.requiresSecretsFrom ?? []) {
        remoteFqns.add(fqn);
      }
      for (const fqn of tool.requestScopesFrom ?? []) {
        remoteFqns.add(fqn);
      }
    }

    if (remoteFqns.size === 0) return;

    _logger.debug(
      `Resolving cross-tool requirements from ${remoteFqns.size} remote tool(s): ${[...remoteFqns].sort().join(", ")}`,
    );

    // Fetch all remote tool definitions concurrently
    // biome-ignore lint/suspicious/noExplicitAny: Arcade SDK response type
    const remoteDefs = new Map<string, any>();

    const fetchResults = await Promise.allSettled(
      [...remoteFqns].map(async (fqn) => {
        try {
          const result = await client.tools.get(fqn);
          return { fqn, result };
        } catch (err) {
          _logger.warn(
            `Failed to fetch remote tool '${fqn}' for cross-tool requirement resolution: ${err instanceof Error ? err.message : String(err)}`,
          );
          return { fqn, result: null };
        }
      }),
    );

    for (const settled of fetchResults) {
      if (settled.status === "fulfilled" && settled.value.result) {
        remoteDefs.set(settled.value.fqn, settled.value.result);
      }
    }

    // Merge requirements into local tools
    for (const tool of this.catalog.getAll()) {
      // Merge secrets from referenced tools
      for (const fqn of tool.requiresSecretsFrom ?? []) {
        const remote = remoteDefs.get(fqn);
        if (!remote) continue;
        const remoteSecrets = remote.requirements?.secrets;
        if (!remoteSecrets || !Array.isArray(remoteSecrets)) continue;

        if (!tool.secrets) {
          tool.secrets = [];
        }
        const existingKeys = new Set(
          tool.secrets.map((s: string) => s.toLowerCase()),
        );

        for (const remoteSecret of remoteSecrets) {
          const key = remoteSecret.key ?? remoteSecret;
          if (typeof key === "string" && !existingKeys.has(key.toLowerCase())) {
            tool.secrets.push(key);
            existingKeys.add(key.toLowerCase());
            _logger.debug(
              `Merged secret '${key}' from '${fqn}' into '${tool.fullyQualifiedName}'`,
            );
          }
        }
      }

      // Merge scopes from referenced tools — collect per-provider auth requirements
      const collectedAuths = new Map<string | undefined, ToolAuthorization>();

      // Seed with the tool's own auth if it has one
      if (tool.auth) {
        collectedAuths.set(tool.auth.providerId, { ...tool.auth });
      }

      for (const fqn of tool.requestScopesFrom ?? []) {
        const remote = remoteDefs.get(fqn);
        if (!remote) continue;
        const remoteAuth = remote.requirements?.authorization;
        if (!remoteAuth) continue;

        const remoteProviderId = remoteAuth.provider_id;
        const remoteProviderType = remoteAuth.provider_type ?? "oauth2";
        const remoteScopes = remoteAuth.oauth2?.scopes ?? [];

        const existing = collectedAuths.get(remoteProviderId);
        if (existing) {
          // Same provider — merge scopes
          if (remoteScopes.length > 0) {
            const existingScopeSet = new Set(existing.scopes ?? []);
            for (const scope of remoteScopes) {
              if (!existingScopeSet.has(scope)) {
                if (!existing.scopes) existing.scopes = [];
                existing.scopes.push(scope);
                existingScopeSet.add(scope);
              }
            }
          }
          _logger.debug(
            `Merged scopes from '${fqn}' into '${tool.fullyQualifiedName}'`,
          );
        } else {
          // New provider — add a new entry
          collectedAuths.set(remoteProviderId, {
            providerId: remoteProviderId,
            providerType: remoteProviderType,
            scopes: remoteScopes.length > 0 ? [...remoteScopes] : undefined,
          });
          _logger.debug(
            `Adopted auth provider '${remoteProviderId}' from '${fqn}' for '${tool.fullyQualifiedName}'`,
          );
        }
      }

      // Apply collected auth requirements back to the tool
      if (collectedAuths.size > 0) {
        const authList = [...collectedAuths.values()];

        // Always set the first provider as the singular authorization
        // (backward compat for clients that only read the singular field)
        tool.auth = authList[0];

        if (authList.length > 1) {
          // Multi-provider: store the full list
          tool.resolvedAuthorizations = authList;
          const providers = authList.map((a) => a.providerId);
          _logger.info(
            `Tool '${tool.fullyQualifiedName}' requires auth from ${authList.length} providers: ${providers.join(", ")}`,
          );
        }
      }
    }
  }

  // ── Runtime tool management ──────────────────────────────

  /**
   * Add a tool at runtime.
   */
  addTool(tool: MaterializedTool): void {
    this.registerTool(tool);
  }

  // ── Prompt registration ──────────────────────────────────

  /**
   * Register all prompts from the prompt manager with the underlying McpServer.
   */
  registerCatalogPrompts(): void {
    if (!this.promptManager) return;
    for (const prompt of this.promptManager.listPrompts()) {
      this.registerPrompt(prompt.name, prompt);
    }
  }

  /**
   * Register a single prompt with the McpServer.
   */
  private registerPrompt(
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

    this.mcpServer.registerPrompt(
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
    this.registerPrompt(name, {
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
      this.registerResource(resource.uri, resource.name, resource);
    }
  }

  /**
   * Register a single resource with the McpServer.
   */
  private registerResource(
    uri: string,
    name: string,
    stored: { description?: string; mimeType?: string },
  ): void {
    this.mcpServer.registerResource(
      name,
      uri,
      {
        description: stored.description,
        mimeType: stored.mimeType,
      } as never,
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
    this.registerResource(uri, name, {
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
      const config = createMcpToolConfig(tool);
      session.registerTool(
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

    if (this.promptManager) {
      for (const prompt of this.promptManager.listPrompts()) {
        const argsSchema: Record<string, z.ZodType> = {};
        if (prompt.arguments) {
          for (const arg of prompt.arguments) {
            const base = arg.description
              ? z.string().describe(arg.description)
              : z.string();
            argsSchema[arg.name] = arg.required ? base : base.optional();
          }
        }
        const config: Record<string, unknown> = {
          description: prompt.description,
        };
        if (Object.keys(argsSchema).length > 0) {
          config.argsSchema = argsSchema;
        }
        session.registerPrompt(
          prompt.name,
          config as never,
          (async (args: Record<string, string>) => {
            return this.promptManager!.getPrompt(prompt.name, args);
          }) as never,
        );
      }
    }

    if (this.resourceManager) {
      for (const resource of this.resourceManager.listResources()) {
        session.registerResource(
          resource.name,
          resource.uri,
          {
            description: resource.description,
            mimeType: resource.mimeType,
          } as never,
          (async (resourceUri: URL) => {
            return this.resourceManager!.readResource(resourceUri.href);
          }) as never,
        );
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

  // Object/Array -> JSON text content with structuredContent
  if (value !== null && value !== undefined) {
    const text = JSON.stringify(value, null, 2);
    const structured =
      typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : { result: value };
    return {
      content: [{ type: "text", text }],
      structuredContent: structured,
    };
  }

  // Null/undefined
  return {
    content: [{ type: "text", text: "" }],
  };
}
