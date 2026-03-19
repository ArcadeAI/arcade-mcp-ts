/**
 * Provider name for LLM execution.
 */
export type ProviderName = "openai" | "anthropic";

/**
 * An expected tool call — the tool name and expected arguments.
 */
export interface ExpectedToolCall {
	toolName: string;
	args: Record<string, unknown>;
}

/**
 * An actual tool call extracted from an LLM response.
 */
export interface ActualToolCall {
	name: string;
	args: Record<string, unknown>;
}

/**
 * Rubric for pass/fail/warning thresholds.
 */
export interface EvalRubric {
	/** Minimum score to pass (0-1). Default 0.8 */
	failThreshold?: number;
	/** Score above this is a clean pass; between fail and warn is a warning. Default 0.9 */
	warnThreshold?: number;
	/** Immediately fail if the wrong tool is selected. Default true */
	failOnToolSelection?: boolean;
	/** Immediately fail if the wrong number of tool calls. Default true */
	failOnToolCallQuantity?: boolean;
	/** Weight given to tool name matching in the score. Default 1.0 */
	toolSelectionWeight?: number;
}

/**
 * Resolved rubric with all defaults applied.
 */
export interface ResolvedEvalRubric {
	failThreshold: number;
	warnThreshold: number;
	failOnToolSelection: boolean;
	failOnToolCallQuantity: boolean;
	toolSelectionWeight: number;
}

/**
 * Result of a single critic evaluation.
 */
export interface CriticResult {
	field: string;
	match: boolean;
	score: number;
	weight: number;
	expected: unknown;
	actual: unknown;
}

/**
 * Result of evaluating a single eval case.
 */
export interface EvaluationResult {
	score: number;
	passed: boolean;
	warning: boolean;
	results: CriticResult[];
	failureReason?: string;
}

/**
 * An MCP-style tool definition for the eval registry.
 */
export interface EvalToolDefinition {
	name: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
}

/**
 * A message in the conversation (for additional context).
 */
export interface EvalMessage {
	role: "user" | "assistant";
	content: string;
}

/**
 * Options for adding a case to an EvalSuite.
 */
export interface EvalCaseOptions {
	name: string;
	userMessage: string;
	expectedToolCalls: ExpectedToolCall[];
	critics?: import("./critics.js").Critic[];
	systemMessage?: string;
	rubric?: EvalRubric;
	additionalMessages?: EvalMessage[];
}

/**
 * Options for running an EvalSuite.
 */
export interface EvalRunOptions {
	/** OpenAI or Anthropic client instance */
	client: unknown;
	/** Model identifier (e.g. "gpt-4o", "claude-sonnet-4-20250514") */
	model: string;
	/** Provider name. Auto-detected from client if omitted. */
	provider?: ProviderName;
	/** Number of times to run each case. Default 1 */
	numRuns?: number;
	/** Seed for reproducibility. Default undefined */
	seed?: number;
}

/**
 * Result of a single case run within a suite.
 */
export interface EvalCaseResult {
	name: string;
	evaluation: EvaluationResult;
	actualToolCalls: ActualToolCall[];
}

/**
 * Result of running an entire eval suite.
 */
export interface EvalSuiteResult {
	suiteName: string;
	model: string;
	provider: ProviderName;
	cases: EvalCaseResult[];
}

/**
 * Resolve an EvalRubric with defaults.
 */
export function resolveRubric(rubric?: EvalRubric): ResolvedEvalRubric {
	return {
		failThreshold: rubric?.failThreshold ?? 0.8,
		warnThreshold: rubric?.warnThreshold ?? 0.9,
		failOnToolSelection: rubric?.failOnToolSelection ?? true,
		failOnToolCallQuantity: rubric?.failOnToolCallQuantity ?? true,
		toolSelectionWeight: rubric?.toolSelectionWeight ?? 1.0,
	};
}

/**
 * Normalize a tool name for comparison — lowercase, replace dots/hyphens with underscores.
 */
export function normalizeToolName(name: string): string {
	return name.toLowerCase().replace(/[.-]/g, "_");
}

/**
 * Compare two tool names with normalization.
 */
export function compareToolNames(a: string, b: string): boolean {
	return normalizeToolName(a) === normalizeToolName(b);
}
