/**
 * Error kinds matching the Python ErrorKind enum.
 */
export enum ErrorKind {
	// Toolkit-level
	TOOLKIT_LOAD_FAILED = "toolkit_load_failed",

	// Tool definition errors
	TOOL_DEFINITION_BAD_DEFINITION = "tool_definition_bad_definition",
	TOOL_DEFINITION_BAD_INPUT_SCHEMA = "tool_definition_bad_input_schema",
	TOOL_DEFINITION_BAD_OUTPUT_SCHEMA = "tool_definition_bad_output_schema",

	// Tool runtime errors
	TOOL_RUNTIME_BAD_INPUT_VALUE = "tool_runtime_bad_input_value",
	TOOL_RUNTIME_BAD_OUTPUT_VALUE = "tool_runtime_bad_output_value",
	TOOL_RUNTIME_RETRY = "tool_runtime_retry",
	TOOL_RUNTIME_CONTEXT_REQUIRED = "tool_runtime_context_required",
	TOOL_RUNTIME_FATAL = "tool_runtime_fatal",

	// Upstream errors
	UPSTREAM_RUNTIME_BAD_REQUEST = "upstream_runtime_bad_request",
	UPSTREAM_RUNTIME_AUTH_ERROR = "upstream_runtime_auth_error",
	UPSTREAM_RUNTIME_NOT_FOUND = "upstream_runtime_not_found",
	UPSTREAM_RUNTIME_VALIDATION_ERROR = "upstream_runtime_validation_error",
	UPSTREAM_RUNTIME_RATE_LIMIT = "upstream_runtime_rate_limit",
	UPSTREAM_RUNTIME_SERVER_ERROR = "upstream_runtime_server_error",
	UPSTREAM_RUNTIME_UNMAPPED = "upstream_runtime_unmapped",

	UNKNOWN = "unknown",
}

/**
 * Base class for all Arcade toolkit errors.
 */
export abstract class ToolkitError extends Error {
	abstract readonly kind: ErrorKind;
	readonly canRetry: boolean = false;
	developerMessage?: string;
	statusCode?: number;
	additionalPromptContent?: string;
	retryAfterMs?: number;
	extra?: Record<string, unknown>;

	constructor(
		message: string,
		options?: {
			cause?: Error;
			developerMessage?: string;
			statusCode?: number;
			additionalPromptContent?: string;
			retryAfterMs?: number;
			extra?: Record<string, unknown>;
		},
	) {
		super(message, { cause: options?.cause });
		this.name = this.constructor.name;
		this.developerMessage = options?.developerMessage;
		this.statusCode = options?.statusCode;
		this.additionalPromptContent = options?.additionalPromptContent;
		this.retryAfterMs = options?.retryAfterMs;
		this.extra = options?.extra;
	}

	get isToolkitError(): boolean {
		return true;
	}

	get isToolError(): boolean {
		return this instanceof ToolError;
	}

	get isUpstreamError(): boolean {
		return this instanceof UpstreamError;
	}

	withContext(name: string): this {
		this.message = `[${this.kind}] ${this.name} in '${name}': ${this.message}`;
		return this;
	}

	toPayload(): Record<string, unknown> {
		return {
			kind: this.kind,
			message: this.message,
			can_retry: this.canRetry,
			developer_message: this.developerMessage,
			status_code: this.statusCode,
			additional_prompt_content: this.additionalPromptContent,
			retry_after_ms: this.retryAfterMs,
			extra: this.extra,
		};
	}
}

/**
 * Error loading a toolkit.
 */
export class ToolkitLoadError extends ToolkitError {
	readonly kind = ErrorKind.TOOLKIT_LOAD_FAILED;
	override readonly canRetry = false;
}

/**
 * Abstract base for tool-level errors.
 */
export abstract class ToolError extends ToolkitError {}

/**
 * Error in tool definition (schema, config).
 */
export class ToolDefinitionError extends ToolError {
	readonly kind: ErrorKind = ErrorKind.TOOL_DEFINITION_BAD_DEFINITION;
}

/**
 * Error in tool input schema definition.
 */
export class ToolInputSchemaError extends ToolDefinitionError {
	override readonly kind: ErrorKind =
		ErrorKind.TOOL_DEFINITION_BAD_INPUT_SCHEMA;
}

/**
 * Error in tool output schema definition.
 */
export class ToolOutputSchemaError extends ToolDefinitionError {
	override readonly kind: ErrorKind =
		ErrorKind.TOOL_DEFINITION_BAD_OUTPUT_SCHEMA;
}

/**
 * Abstract base for runtime tool errors.
 */
export abstract class ToolRuntimeError extends ToolError {
	declare readonly canRetry: boolean;
}

/**
 * Input serialization/validation failed.
 */
export class ToolInputError extends ToolRuntimeError {
	readonly kind = ErrorKind.TOOL_RUNTIME_BAD_INPUT_VALUE;
	override readonly statusCode = 400;
}

/**
 * Output serialization/validation failed.
 */
export class ToolOutputError extends ToolRuntimeError {
	readonly kind = ErrorKind.TOOL_RUNTIME_BAD_OUTPUT_VALUE;
	override readonly statusCode = 500;
}

/**
 * Tool execution failed but can be retried.
 */
export class RetryableToolError extends ToolRuntimeError {
	readonly kind = ErrorKind.TOOL_RUNTIME_RETRY;
	override readonly canRetry: boolean = true;
}

/**
 * Tool requires additional context to proceed.
 */
export class ContextRequiredToolError extends ToolRuntimeError {
	readonly kind = ErrorKind.TOOL_RUNTIME_CONTEXT_REQUIRED;
}

/**
 * Fatal tool execution error.
 */
export class FatalToolError extends ToolRuntimeError {
	readonly kind = ErrorKind.TOOL_RUNTIME_FATAL;
	override readonly statusCode = 500;
}

/**
 * Error from an upstream service.
 */
export class UpstreamError extends ToolRuntimeError {
	override readonly kind: ErrorKind;

	constructor(
		message: string,
		options?: {
			statusCode?: number;
			cause?: Error;
			developerMessage?: string;
			additionalPromptContent?: string;
			retryAfterMs?: number;
			extra?: Record<string, unknown>;
		},
	) {
		super(message, options);
		this.statusCode = options?.statusCode;
		this.kind = UpstreamError.kindFromStatusCode(this.statusCode);
	}

	static kindFromStatusCode(statusCode?: number): ErrorKind {
		if (!statusCode) return ErrorKind.UPSTREAM_RUNTIME_UNMAPPED;
		if (statusCode === 400) return ErrorKind.UPSTREAM_RUNTIME_BAD_REQUEST;
		if (statusCode === 401 || statusCode === 403)
			return ErrorKind.UPSTREAM_RUNTIME_AUTH_ERROR;
		if (statusCode === 404) return ErrorKind.UPSTREAM_RUNTIME_NOT_FOUND;
		if (statusCode === 422) return ErrorKind.UPSTREAM_RUNTIME_VALIDATION_ERROR;
		if (statusCode === 429) return ErrorKind.UPSTREAM_RUNTIME_RATE_LIMIT;
		if (statusCode >= 500) return ErrorKind.UPSTREAM_RUNTIME_SERVER_ERROR;
		return ErrorKind.UPSTREAM_RUNTIME_UNMAPPED;
	}
}

/**
 * Rate limit error from upstream.
 */
export class UpstreamRateLimitError extends UpstreamError {
	override readonly kind = ErrorKind.UPSTREAM_RUNTIME_RATE_LIMIT;

	constructor(
		message: string,
		options?: {
			retryAfterMs?: number;
			cause?: Error;
			developerMessage?: string;
			extra?: Record<string, unknown>;
		},
	) {
		super(message, { ...options, statusCode: 429 });
	}
}

/**
 * Server-level errors (not tool-related).
 */
export class ServerError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ServerError";
	}
}
