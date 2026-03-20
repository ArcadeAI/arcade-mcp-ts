import pino from "pino";
import type { z } from "zod";
import { ToolCatalog } from "./catalog.js";
import { ServerError } from "./exceptions.js";
import { PromptManager } from "./managers/prompt-manager.js";
import { ResourceManager } from "./managers/resource-manager.js";
import { ArcadeMCPServer } from "./server.js";
import { loadSettings, type MCPSettings } from "./settings.js";
import { OTELHandler } from "./telemetry.js";
import type { HttpHandle } from "./transports/http.js";
import type {
  MaterializedTool,
  MCPAppOptions,
  Middleware,
  PromptHandler,
  PromptOptions,
  ResourceHandler,
  ResourceOptions,
  ResourceServerValidatorInterface,
  ToolHandler,
  ToolkitInfo,
  ToolOptions,
  TransportOptions,
} from "./types.js";
import { ServerTracker } from "./usage/index.js";

const logger = pino({ name: "arcade-mcp-app" });

const NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9]*(?:_[a-zA-Z0-9]+)*$/;

/**
 * MCPApp — the high-level builder API for creating Arcade MCP servers.
 *
 * ```ts
 * const app = new MCPApp({ name: "MyServer", version: "1.0.0" });
 * app.tool("echo", { description: "Echo", parameters: z.object({ msg: z.string() }) },
 *   async (args, ctx) => args.msg
 * );
 * app.run();
 * ```
 */
export class MCPApp {
  readonly name: string;
  readonly version: string;
  readonly title?: string;
  readonly instructions?: string;

  private _catalog: ToolCatalog;
  private _promptManager: PromptManager;
  private _resourceManager: ResourceManager;
  private _settings: MCPSettings;
  private _middleware: Middleware[];
  private _auth?: ResourceServerValidatorInterface;
  private _server?: ArcadeMCPServer;
  private _telemetry?: OTELHandler;
  private _tracker?: ServerTracker;
  private _toolkitInfo: ToolkitInfo;
  private _onReload?: (changedFiles: string[]) => Promise<void>;

  constructor(options: MCPAppOptions) {
    if (!NAME_REGEX.test(options.name)) {
      throw new Error(
        `Invalid app name '${options.name}': must be alphanumeric with underscores, start with a letter, no consecutive underscores`,
      );
    }

    this.name = options.name;
    this.version = options.version ?? "0.1.0";
    this.title = options.title ?? options.name;
    this.instructions = options.instructions;

    this._catalog = new ToolCatalog();
    this._promptManager = new PromptManager();
    this._resourceManager = new ResourceManager();
    this._settings = loadSettings();
    this._middleware = options.middleware ?? [];
    this._auth = options.auth;
    this._toolkitInfo = {
      name: options.name,
      version: options.version,
      description: options.title ?? options.name,
    };
  }

  /**
   * Register a tool using the builder pattern.
   */
  tool<T extends z.ZodType>(
    name: string,
    options: ToolOptions<T>,
    handler: ToolHandler<z.infer<T>>,
  ): this {
    this._catalog.addTool(name, options, handler, this._toolkitInfo);
    return this;
  }

  /**
   * Add tools from a module/object that exports tool definitions.
   * Each key should map to { options: ToolOptions, handler: ToolHandler }.
   */
  addToolsFrom(
    module: Record<string, { options: ToolOptions; handler: ToolHandler }>,
  ): this {
    for (const [name, def] of Object.entries(module)) {
      this._catalog.addTool(name, def.options, def.handler, this._toolkitInfo);
    }
    return this;
  }

  /**
   * Register a prompt using the builder pattern.
   */
  prompt(name: string, options: PromptOptions, handler?: PromptHandler): this {
    this._promptManager.addPrompt(name, options, handler);
    return this;
  }

  /**
   * Register a resource using the builder pattern.
   */
  resource(
    uri: string,
    options: ResourceOptions,
    handler?: ResourceHandler,
  ): this {
    // Derive a name from the URI if not provided
    const name = uri;
    this._resourceManager.addResource(uri, name, options, handler);
    return this;
  }

  /**
   * Runtime tool management API.
   */
  get tools(): ToolsAPI {
    return new ToolsAPI(this);
  }

  /**
   * Runtime prompt management API.
   */
  get prompts(): PromptsAPI {
    return new PromptsAPI(this);
  }

  /**
   * Runtime resource management API.
   */
  get resources(): ResourcesAPI {
    return new ResourcesAPI(this);
  }

  /**
   * Start the server with the specified transport.
   */
  async run(options?: TransportOptions): Promise<void> {
    const transport =
      options?.transport ??
      (process.env.ARCADE_SERVER_TRANSPORT as "stdio" | "http") ??
      "stdio";
    const host = options?.host ?? process.env.ARCADE_SERVER_HOST ?? "127.0.0.1";
    const port =
      options?.port ??
      (process.env.ARCADE_SERVER_PORT
        ? Number.parseInt(process.env.ARCADE_SERVER_PORT, 10)
        : 8000);
    const dev = options?.dev ?? process.env.ARCADE_SERVER_RELOAD === "1";

    // Initialize telemetry if enabled
    if (this._settings.telemetry.enable) {
      this._telemetry = new OTELHandler({
        enable: true,
        serviceName: this._settings.telemetry.serviceName,
        environment: this._settings.arcade.environment,
      });
      this._telemetry.initialize();

      const shutdownTelemetry = async () => {
        await this._telemetry?.shutdown();
      };
      process.on("SIGINT", shutdownTelemetry);
      process.on("SIGTERM", shutdownTelemetry);
      process.on("beforeExit", shutdownTelemetry);
    }

    // Initialize usage tracking
    this._tracker = new ServerTracker(this.version);
    this._tracker.trackServerStart({
      transport,
      host,
      port,
      toolCount: this._catalog.size,
      resourceServerType: this._auth ? "jwt" : undefined,
    });

    const shutdownTracker = async () => {
      await this._tracker?.shutdown();
    };
    process.on("SIGINT", shutdownTracker);
    process.on("SIGTERM", shutdownTracker);
    process.on("beforeExit", shutdownTracker);

    if (dev && transport === "stdio") {
      logger.warn(
        "Dev mode (auto-reload) is not supported with stdio transport. Starting without reload.",
      );
    }

    if (dev && transport === "http") {
      await this._runHttpWithReload({
        host,
        port,
        eventStore: options?.eventStore,
        stateless: options?.stateless,
        sessionTtlMs: options?.sessionTtlMs,
        maxSessions: options?.maxSessions,
      });
    } else {
      await this._runOnce(transport, host, port, options);
    }
  }

  /**
   * Create the server, register components, and run the transport.
   */
  private async _runOnce(
    transport: "stdio" | "http",
    host: string,
    port: number,
    transportOptions?: TransportOptions,
  ): Promise<void> {
    this._server = this._createServer();

    if (transport === "stdio") {
      const { runStdio } = await import("./transports/stdio.js");
      await runStdio(this._server);
    } else {
      const { runHttp } = await import("./transports/http.js");
      await runHttp(this._server, {
        host,
        port,
        auth: this._auth,
        eventStore: transportOptions?.eventStore,
        stateless: transportOptions?.stateless,
        sessionTtlMs: transportOptions?.sessionTtlMs,
        maxSessions: transportOptions?.maxSessions,
        workerSecret: this._settings.arcade.serverSecret,
        catalog: this._catalog,
        telemetry: this._telemetry,
      });
    }
  }

  /**
   * Create a new ArcadeMCPServer and register all components.
   */
  private _createServer(): ArcadeMCPServer {
    const server = new ArcadeMCPServer(this._catalog, {
      name: this.name,
      version: this.version,
      title: this.title,
      instructions: this.instructions,
      settings: this._settings,
      middleware: this._middleware as never[],
      auth: this._auth,
      telemetry: this._telemetry,
      tracker: this._tracker,
      promptManager: this._promptManager,
      resourceManager: this._resourceManager,
    });

    server.registerCatalogTools();
    server.registerCatalogPrompts();
    server.registerCatalogResources();

    return server;
  }

  /**
   * Run in dev mode: start HTTP server, watch files, restart on changes.
   */
  private async _runHttpWithReload(options: {
    host: string;
    port: number;
    eventStore?: import("./event-store.js").EventStore;
    stateless?: boolean;
    sessionTtlMs?: number;
    maxSessions?: number;
  }): Promise<void> {
    const { startHttp } = await import("./transports/http.js");
    const { watchForChanges } = await import("./transports/dev-reload.js");
    const { setupGracefulShutdown } = await import("./transports/shutdown.js");

    this._server = this._createServer();
    let handle: HttpHandle = await startHttp(this._server, {
      ...options,
      auth: this._auth,
      workerSecret: this._settings.arcade.serverSecret,
      catalog: this._catalog,
      telemetry: this._telemetry,
    });

    logger.info("Dev mode enabled — watching for file changes...");

    const watcher = watchForChanges({
      dir: process.cwd(),
      logger,
      onChange: async (changedFiles) => {
        // Stop the current HTTP server
        await handle.stop();

        // Re-import tool modules if there's a reload callback
        if (this._onReload) {
          await this._onReload(changedFiles);
        }

        // Create a fresh server and start it
        this._server = this._createServer();
        handle = await startHttp(this._server, {
          ...options,
          auth: this._auth,
          workerSecret: this._settings.arcade.serverSecret,
          catalog: this._catalog,
          telemetry: this._telemetry,
        });

        logger.info("Server reloaded successfully.");
      },
    });

    // Block until shutdown
    await setupGracefulShutdown({
      logger,
      onShutdown: async () => {
        watcher.close();
        await handle.stop();
      },
    });
  }

  /**
   * Set a callback invoked during dev-mode reload, before the server restarts.
   * Typically used by the CLI to re-discover and re-import tool modules.
   */
  onReload(callback: (changedFiles: string[]) => Promise<void>): this {
    this._onReload = callback;
    return this;
  }

  /**
   * Get the underlying server (available after run() is called).
   */
  get server(): ArcadeMCPServer | undefined {
    return this._server;
  }

  /**
   * Get the catalog (available immediately for build-time operations).
   */
  get catalog(): ToolCatalog {
    return this._catalog;
  }

  /**
   * Get settings.
   */
  get settings(): MCPSettings {
    return this._settings;
  }

  /**
   * Get the prompt manager (available immediately for build-time operations).
   */
  get promptManager(): PromptManager {
    return this._promptManager;
  }

  /**
   * Get the resource manager (available immediately for build-time operations).
   */
  get resourceManager(): ResourceManager {
    return this._resourceManager;
  }
}

/**
 * Get the running server or throw if not started yet.
 */
function requireServer(app: MCPApp, entity: string): ArcadeMCPServer {
  if (!app.server) {
    throw new ServerError(
      `Server not started. Call app.run() before managing runtime ${entity}.`,
    );
  }
  return app.server;
}

/**
 * Runtime tools API — add/update/remove tools after server is running.
 */
class ToolsAPI {
  constructor(private app: MCPApp) {}

  add<T extends z.ZodType>(
    name: string,
    options: ToolOptions<T>,
    handler: ToolHandler<z.infer<T>>,
  ): void {
    const server = requireServer(this.app, "tools");
    const now = new Date();
    const tool: MaterializedTool = {
      name,
      fullyQualifiedName: name,
      description: options.description,
      handler: handler as ToolHandler,
      parameters: options.parameters,
      auth: options.auth,
      secrets: options.secrets,
      metadata: options.metadata,
      dateAdded: now,
      dateUpdated: now,
    };
    server.addTool(tool);
  }

  remove(name: string): boolean {
    return this.app.catalog.removeTool(name);
  }

  list(): string[] {
    return this.app.catalog.getToolNames();
  }
}

/**
 * Runtime prompts API — add/remove/list prompts after server is running.
 */
class PromptsAPI {
  constructor(private app: MCPApp) {}

  add(name: string, options: PromptOptions, handler?: PromptHandler): void {
    const server = requireServer(this.app, "prompts");
    this.app.promptManager.addPrompt(name, options, handler);
    server.addPrompt(name, options, handler);
  }

  remove(name: string): boolean {
    try {
      this.app.promptManager.removePrompt(name);
      return true;
    } catch {
      return false;
    }
  }

  list(): string[] {
    return this.app.promptManager.getPromptNames();
  }
}

/**
 * Runtime resources API — add/remove/list resources after server is running.
 */
class ResourcesAPI {
  constructor(private app: MCPApp) {}

  add(uri: string, options: ResourceOptions, handler?: ResourceHandler): void {
    const server = requireServer(this.app, "resources");
    const name = uri;
    this.app.resourceManager.addResource(uri, name, options, handler);
    server.addResource(uri, name, options, handler);
  }

  remove(uri: string): boolean {
    try {
      this.app.resourceManager.removeResource(uri);
      return true;
    } catch {
      return false;
    }
  }

  list(): string[] {
    return this.app.resourceManager.getResourceUris();
  }
}
