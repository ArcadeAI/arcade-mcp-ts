import { Elysia } from "elysia";
import pino from "pino";
import type { ToolCatalog } from "../catalog.js";
import { toToolDefinition } from "../catalog.js";
import { Context } from "../context.js";
import { runTool } from "../executor.js";
import type { ToolCallRequest, ToolCallResponse } from "../types.js";

const logger = pino({ name: "arcade-mcp-worker" });

export interface WorkerRoutesOptions {
	catalog: ToolCatalog;
	secret?: string;
	basePath?: string;
}

/**
 * Create Elysia worker routes for /worker/v1/*.
 * Protected by ARCADE_WORKER_SECRET Bearer token.
 */
// biome-ignore lint/suspicious/noExplicitAny: Elysia generic prefix typing
export function createWorkerRoutes(options: WorkerRoutesOptions): Elysia<any> {
	const secret = options.secret ?? process.env.ARCADE_WORKER_SECRET;
	const basePath = options.basePath ?? "/worker";
	const catalog = options.catalog;

	const app = new Elysia({ prefix: basePath });

	// Auth middleware for worker routes
	function validateWorkerAuth(request: Request): boolean {
		if (!secret) return true; // No auth if no secret configured

		const authHeader = request.headers.get("authorization");
		if (!authHeader?.startsWith("Bearer ")) return false;
		return authHeader.slice(7) === secret;
	}

	// GET /worker/tools — list available tools
	app.get("/tools", ({ request }) => {
		if (!validateWorkerAuth(request)) {
			return new Response(JSON.stringify({ error: "Unauthorized" }), {
				status: 401,
				headers: { "Content-Type": "application/json" },
			});
		}

		const tools = [];
		for (const tool of catalog.getAll()) {
			tools.push(toToolDefinition(tool));
		}

		return { tools };
	});

	// POST /worker/tools/invoke — execute a tool
	app.post("/tools/invoke", async ({ request }) => {
		if (!validateWorkerAuth(request)) {
			return new Response(JSON.stringify({ error: "Unauthorized" }), {
				status: 401,
				headers: { "Content-Type": "application/json" },
			});
		}

		const body = (await request.json()) as ToolCallRequest;
		const executionId = crypto.randomUUID();
		const startTime = performance.now();

		const tool = catalog.getTool(body.name);
		if (!tool) {
			return new Response(
				JSON.stringify({
					error: `Tool '${body.name}' not found`,
				}),
				{
					status: 404,
					headers: { "Content-Type": "application/json" },
				},
			);
		}

		// Inject secrets declared by the tool from env, then overlay
		// any secrets provided in the request context (caller wins)
		const secrets: Record<string, string> = {};
		if (tool.secrets) {
			for (const name of tool.secrets) {
				const value = process.env[name];
				if (value !== undefined) {
					secrets[name] = value;
				}
			}
		}
		if (body.context?.secrets) {
			for (const { key, value } of body.context.secrets) {
				secrets[key] = value;
			}
		}

		// Create a minimal context for worker execution
		const abortController = new AbortController();
		const fakeExtra = {
			signal: abortController.signal,
			requestId: executionId,
			sendNotification: async () => {},
			sendRequest: async () => ({}),
		};

		const context = new Context(fakeExtra as never, {
			requestId: executionId,
			toolContext: {
				authToken: body.context?.authorization?.token,
				secrets,
				metadata: {},
				userId: body.userId,
			},
		});

		const result = await runTool(tool, body.inputs ?? {}, context);

		const duration = performance.now() - startTime;

		const response: ToolCallResponse = {
			executionId,
			duration,
			finishedAt: new Date().toISOString(),
			success: result.success,
			output: result.success
				? { value: result.value }
				: { error: result.error?.message },
		};

		logger.info(
			{
				tool: body.name,
				executionId,
				duration: `${duration.toFixed(1)}ms`,
				success: result.success,
			},
			"Tool executed via worker",
		);

		return response;
	});

	// GET /worker/health — health check
	app.get("/health", () => {
		return {
			status: "ok",
			tool_count: String(catalog.size),
		};
	});

	return app;
}
