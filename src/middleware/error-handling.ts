import type { CallNext, MiddlewareContext } from "../types.js";
import { Middleware } from "./base.js";

/**
 * Error handling middleware. Catches errors and converts them
 * to appropriate MCP error responses.
 */
export class ErrorHandlingMiddleware extends Middleware {
	private maskErrorDetails: boolean;

	constructor(maskErrorDetails = false) {
		super();
		this.maskErrorDetails = maskErrorDetails;
	}

	override async onMessage(
		context: MiddlewareContext,
		next: CallNext,
	): Promise<unknown> {
		try {
			return await next(context);
		} catch (error) {
			return this.handleError(context, error);
		}
	}

	override async onCallTool(
		context: MiddlewareContext,
		next: CallNext,
	): Promise<unknown> {
		try {
			return await next(context);
		} catch (error) {
			// For tool calls, return CallToolResult with isError=true
			const message = this.getErrorMessage(error);
			return {
				content: [{ type: "text", text: message }],
				isError: true,
				structuredContent: { error: message },
			};
		}
	}

	private handleError(
		context: MiddlewareContext,
		error: unknown,
	): { id: string | undefined; error: { code: number; message: string } } {
		const message = this.getErrorMessage(error);
		const code = this.getErrorCode(error);
		return {
			id: context.requestId,
			error: { code, message },
		};
	}

	private getErrorMessage(error: unknown): string {
		if (!this.maskErrorDetails) {
			return error instanceof Error ? error.message : String(error);
		}

		if (
			error instanceof TypeError ||
			error instanceof RangeError ||
			error instanceof SyntaxError
		) {
			return "Invalid request parameters";
		}

		if (error instanceof Error) {
			if (error.message.includes("not found")) {
				return "Resource not found";
			}
			if (
				error.message.includes("permission") ||
				error.message.includes("unauthorized")
			) {
				return "Permission denied";
			}
		}

		return "Internal server error";
	}

	private getErrorCode(error: unknown): number {
		if (
			error instanceof TypeError ||
			error instanceof RangeError ||
			error instanceof SyntaxError
		) {
			return -32602; // Invalid params
		}
		if (error instanceof Error && error.message.includes("not found")) {
			return -32601; // Method not found
		}
		return -32603; // Internal error
	}
}
