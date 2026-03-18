import type { z } from "zod";
import { ToolCatalog } from "./catalog.js";
import { ServerError } from "./exceptions.js";
import { PromptManager } from "./managers/prompt-manager.js";
import { ResourceManager } from "./managers/resource-manager.js";
import { ArcadeMCPServer } from "./server.js";
import { loadSettings, type MCPSettings } from "./settings.js";
import { OTELHandler } from "./telemetry.js";
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
	private _toolkitInfo: ToolkitInfo;

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

		// Create server
		this._server = new ArcadeMCPServer(this._catalog, {
			name: this.name,
			version: this.version,
			title: this.title,
			instructions: this.instructions,
			settings: this._settings,
			middleware: this._middleware as never[],
			auth: this._auth,
			telemetry: this._telemetry,
			promptManager: this._promptManager,
			resourceManager: this._resourceManager,
		});

		// Register all components from catalogs/managers
		this._server.registerCatalogTools();
		this._server.registerCatalogPrompts();
		this._server.registerCatalogResources();

		if (transport === "stdio") {
			const { runStdio } = await import("./transports/stdio.js");
			await runStdio(this._server);
		} else {
			const { runHttp } = await import("./transports/http.js");
			await runHttp(this._server, { host, port, auth: this._auth });
		}
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
 * Runtime tools API — add/update/remove tools after server is running.
 */
class ToolsAPI {
	constructor(private app: MCPApp) {}

	private requireServer(): ArcadeMCPServer {
		if (!this.app.server) {
			throw new ServerError(
				"Server not started. Call app.run() before managing runtime tools.",
			);
		}
		return this.app.server;
	}

	add<T extends z.ZodType>(
		name: string,
		options: ToolOptions<T>,
		handler: ToolHandler<z.infer<T>>,
	): void {
		const server = this.requireServer();
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

	private requireServer(): ArcadeMCPServer {
		if (!this.app.server) {
			throw new ServerError(
				"Server not started. Call app.run() before managing runtime prompts.",
			);
		}
		return this.app.server;
	}

	add(name: string, options: PromptOptions, handler?: PromptHandler): void {
		const server = this.requireServer();
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

	private requireServer(): ArcadeMCPServer {
		if (!this.app.server) {
			throw new ServerError(
				"Server not started. Call app.run() before managing runtime resources.",
			);
		}
		return this.app.server;
	}

	add(uri: string, options: ResourceOptions, handler?: ResourceHandler): void {
		const server = this.requireServer();
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
