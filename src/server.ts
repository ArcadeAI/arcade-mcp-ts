import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import pino from "pino";
import { z } from "zod";
import type { ToolCatalog } from "./catalog.js";
import {
	Context,
	type ServerExtra,
	setCurrentContext,
	type ToolContextData,
} from "./context.js";
import { runTool } from "./executor.js";
import type { PromptManager } from "./managers/prompt-manager.js";
import type { ResourceManager } from "./managers/resource-manager.js";
import { applyMiddleware } from "./middleware/base.js";
import { ErrorHandlingMiddleware } from "./middleware/error-handling.js";
import { LoggingMiddleware } from "./middleware/logging.js";
import type { MCPSettings } from "./settings.js";
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

const _logger = pino({ name: "arcade-mcp-server" });

export interface ArcadeMCPServerOptions {
	name: string;
	version: string;
	title?: string;
	instructions?: string;
	settings?: MCPSettings;
	middleware?: MiddlewareInterface[];
	auth?: ResourceServerValidatorInterface;
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
	private promptManager?: PromptManager;
	private resourceManager?: ResourceManager;
	private name: string;
	private version: string;

	constructor(catalog: ToolCatalog, options: ArcadeMCPServerOptions) {
		this.catalog = catalog;
		this.name = options.name;
		this.version = options.version;
		this.settings = options.settings;
		this.auth = options.auth;
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
			this.registerTool(tool);
		}
	}

	/**
	 * Register a single tool with the McpServer, wrapping the handler
	 * to inject Context and apply middleware.
	 */
	private registerTool(tool: MaterializedTool): void {
		this.mcpServer.registerTool(
			tool.fullyQualifiedName,
			{
				description: tool.description,
				inputSchema: tool.parameters as never,
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
		// Build tool context with secrets
		const toolCtxData = this.buildToolContext(tool);

		// Build Context
		const context = new Context(extra, {
			requestId: String(extra.requestId ?? crypto.randomUUID()),
			sessionId: extra.sessionId,
			resourceOwner: this.extractResourceOwner(extra),
			toolContext: toolCtxData,
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
			setCurrentContext(prevCtx);
		}
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
		return this.settings?.arcade.userId ?? process.env.ARCADE_USER_ID;
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
		this.registerResource(uri, name, {
			description: options.description,
			mimeType: options.mimeType,
		});
	}

	/**
	 * Get the underlying McpServer for transport connection.
	 */
	getServer(): McpServer {
		return this.mcpServer;
	}

	/**
	 * Get the catalog.
	 */
	getCatalog(): ToolCatalog {
		return this.catalog;
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
