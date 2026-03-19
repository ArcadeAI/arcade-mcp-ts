import { SpanStatusCode } from "@opentelemetry/api";
import { Elysia } from "elysia";
import * as jose from "jose";
import type { ToolCatalog } from "../catalog.js";
import { Context } from "../context.js";
import { ServerError } from "../exceptions.js";
import { runTool } from "../executor.js";
import { createLogger } from "../logger.js";
import type { OTELHandler } from "../telemetry.js";
import { TOOL_NAME_SEPARATOR } from "../types.js";
import { toWorkerToolDefinition } from "./convert.js";
import type {
  WorkerToolCallOutput,
  WorkerToolCallRequest,
  WorkerToolCallResponse,
  WorkerToolDefinition,
} from "./types.js";

const logger = createLogger("arcade-mcp-worker");

export interface WorkerRoutesOptions {
  catalog: ToolCatalog;
  secret?: string;
  basePath?: string;
  telemetry?: OTELHandler;
}

/**
 * Create Elysia worker routes for /worker/*.
 * Protected by ARCADE_WORKER_SECRET Bearer token.
 */
// biome-ignore lint/suspicious/noExplicitAny: Elysia generic prefix typing
export function createWorkerRoutes(options: WorkerRoutesOptions): Elysia<any> {
  const rawSecret = options.secret ?? process.env.ARCADE_WORKER_SECRET;
  if (!rawSecret) {
    throw new ServerError(
      "No secret provided for worker routes. Set the ARCADE_WORKER_SECRET environment variable.",
    );
  }
  const secret: string = rawSecret;
  const secretKey = new TextEncoder().encode(secret);

  const basePath = options.basePath ?? "/worker";
  const catalog = options.catalog;
  const telemetry = options.telemetry;
  const environment = process.env.ARCADE_ENVIRONMENT ?? "dev";

  const app = new Elysia({ prefix: basePath });

  // Auth middleware for worker routes (JWT HS256 verification)
  async function validateWorkerAuth(request: Request): Promise<boolean> {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return false;
    const token = authHeader.slice(7);
    try {
      const { payload } = await jose.jwtVerify(token, secretKey, {
        algorithms: ["HS256"],
        audience: "worker",
      });
      return payload.ver === "1";
    } catch {
      return false;
    }
  }

  // GET /worker/tools — list available tools (returns bare array like Python)
  app.get("/tools", async ({ request }) => {
    if (!(await validateWorkerAuth(request))) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const getCatalog = (): WorkerToolDefinition[] => {
      const tools: WorkerToolDefinition[] = [];
      for (const tool of catalog.getAll()) {
        tools.push(toWorkerToolDefinition(tool));
      }
      return tools;
    };

    const tracer = telemetry?.enabled
      ? telemetry.getTracer("arcade-mcp-worker")
      : undefined;
    if (!tracer) return getCatalog();

    return tracer.startActiveSpan("Catalog", (span) => {
      try {
        return getCatalog();
      } finally {
        span.end();
      }
    });
  });

  // POST /worker/tools/invoke — execute a tool
  app.post("/tools/invoke", async ({ request }) => {
    if (!(await validateWorkerAuth(request))) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = (await request.json()) as WorkerToolCallRequest;

    // Use execution_id from request if provided (Engine sets this), otherwise generate
    const executionId = body.execution_id ?? crypto.randomUUID();
    const startTime = performance.now();

    // Resolve tool by fully-qualified name: toolkit.tool_name
    const fqn = `${body.tool.toolkit}${TOOL_NAME_SEPARATOR}${body.tool.name}`;
    const tool = catalog.getTool(fqn) ?? catalog.getTool(body.tool.name);
    if (!tool) {
      return new Response(
        JSON.stringify({
          error: `Tool '${fqn}' not found`,
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const invokeInner = async () => {
      // Inject secrets declared by the tool from env, then overlay
      // any secrets provided in the request context (caller wins,
      // but only for secrets the tool has declared)
      const secrets: Record<string, string> = {};
      if (tool.secrets) {
        for (const name of tool.secrets) {
          const value = process.env[name];
          if (value !== undefined) {
            secrets[name] = value;
          }
        }
      }
      if (body.context?.secrets && tool.secrets) {
        const allowed = new Set(tool.secrets);
        for (const { key, value } of body.context.secrets) {
          if (allowed.has(key)) {
            secrets[key] = value;
          }
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
          authToken: body.context?.authorization?.token ?? undefined,
          secrets,
          metadata: {},
          userId: body.context?.user_id ?? undefined,
        },
      });

      const result = await runTool(tool, body.inputs ?? {}, context);

      const duration = performance.now() - startTime;

      // Build output matching Python's ToolCallOutput structure
      const output: WorkerToolCallOutput = result.success
        ? { value: result.value, error: null, requires_authorization: null }
        : {
            value: null,
            error: result.error
              ? {
                  message: result.error.message,
                  kind: result.error.kind ?? "tool_runtime_fatal",
                  developer_message: null,
                  can_retry: result.error.canRetry ?? false,
                  additional_prompt_content:
                    result.error.additionalPromptContent ?? null,
                  retry_after_ms: result.error.retryAfterMs ?? null,
                  stacktrace: result.error.extra?.stacktrace
                    ? String(result.error.extra.stacktrace)
                    : null,
                  status_code: result.error.statusCode ?? null,
                  extra: result.error.extra ?? null,
                }
              : {
                  message: "Unknown error",
                  kind: "tool_runtime_fatal",
                  can_retry: false,
                  developer_message: null,
                  additional_prompt_content: null,
                  retry_after_ms: null,
                  stacktrace: null,
                  status_code: null,
                  extra: null,
                },
            requires_authorization: null,
          };

      const response: WorkerToolCallResponse = {
        execution_id: executionId,
        duration,
        finished_at: new Date().toISOString(),
        success: result.success,
        output,
      };

      logger.info(
        {
          tool: fqn,
          execution_id: executionId,
          duration: `${duration.toFixed(1)}ms`,
          success: result.success,
        },
        "Tool executed via worker",
      );

      return response;
    };

    const tracer = telemetry?.enabled
      ? telemetry.getTracer("arcade-mcp-worker")
      : undefined;

    if (!tracer) return invokeInner();

    return tracer.startActiveSpan("CallTool", async (span) => {
      span.setAttributes({
        tool_name: fqn,
        toolkit_name: tool.name,
        environment,
      });
      try {
        const response = await invokeInner();
        return response;
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
