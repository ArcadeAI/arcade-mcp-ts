import type { z } from "zod";
import type { Context } from "./context.js";
import { ToolInputError, type ToolRuntimeError } from "./errors.js";
import type { MaterializedTool } from "./types.js";

/**
 * Result of tool execution.
 */
export interface ToolExecutionResult {
	success: boolean;
	value?: unknown;
	error?: {
		message: string;
		kind?: string;
		canRetry?: boolean;
		retryAfterMs?: number;
		additionalPromptContent?: string;
		statusCode?: number;
		extra?: Record<string, unknown>;
	};
}

/**
 * Run a tool: validate input, inject context, execute handler, validate output.
 */
export async function runTool(
	tool: MaterializedTool,
	inputs: Record<string, unknown>,
	context: Context,
): Promise<ToolExecutionResult> {
	try {
		const validated = await validateInput(tool.parameters, inputs);
		const result = await tool.handler(validated, context);
		return { success: true, value: result };
	} catch (error) {
		return handleToolError(error);
	}
}

/**
 * Validate tool inputs against Zod schema.
 */
export async function validateInput(
	schema: z.ZodType,
	inputs: Record<string, unknown>,
): Promise<unknown> {
	const result = schema.safeParse(inputs);
	if (!result.success) {
		throw new ToolInputError(
			`Input validation failed: ${result.error.message}`,
			{ developerMessage: JSON.stringify(result.error.issues) },
		);
	}
	return result.data;
}

/**
 * Handle errors from tool execution, returning structured results.
 */
export function handleToolError(error: unknown): ToolExecutionResult {
	if (error instanceof Error && "kind" in error) {
		const toolErr = error as ToolRuntimeError;
		return {
			success: false,
			error: {
				message: toolErr.message,
				kind: toolErr.kind,
				canRetry: toolErr.canRetry,
				retryAfterMs: toolErr.retryAfterMs,
				additionalPromptContent: toolErr.additionalPromptContent,
				statusCode: toolErr.statusCode,
				extra: toolErr.extra,
			},
		};
	}

	const message = error instanceof Error ? error.message : String(error);
	const stack = error instanceof Error ? error.stack : undefined;

	return {
		success: false,
		error: {
			message,
			kind: "tool_runtime_fatal",
			canRetry: false,
			extra: stack ? { stacktrace: stack } : undefined,
		},
	};
}
