/**
 * Example eval: Simple echo tool evaluation using manual tool definitions.
 *
 * Usage (OpenAI):
 *   OPENAI_API_KEY=sk-... bun run examples/evals/echo-eval.ts
 *
 * Usage (Anthropic):
 *   ANTHROPIC_API_KEY=sk-ant-... bun run examples/evals/echo-eval.ts
 */
import type { ProviderName } from "../../src/evals/index.js";
import { BinaryCritic, EvalSuite } from "../../src/evals/index.js";

async function main() {
	const suite = new EvalSuite({
		name: "Echo Tool Evaluation",
		systemMessage: "You are a helpful assistant. Use tools when appropriate.",
		rubric: { failThreshold: 0.85, warnThreshold: 0.95 },
	});

	// Register tool definitions manually (MCP-style)
	suite.addToolDefinitions([
		{
			name: "echo",
			description: "Echo back the given message exactly as provided",
			inputSchema: {
				type: "object",
				properties: {
					message: {
						type: "string",
						description: "The message to echo back",
					},
				},
				required: ["message"],
			},
		},
		{
			name: "reverse",
			description: "Reverse a given string",
			inputSchema: {
				type: "object",
				properties: {
					text: {
						type: "string",
						description: "The text to reverse",
					},
				},
				required: ["text"],
			},
		},
	]);

	// Case 1: Simple echo
	suite.addCase({
		name: "Echo a greeting",
		userMessage: 'Echo the message "Hello, world!"',
		expectedToolCalls: [
			{ toolName: "echo", args: { message: "Hello, world!" } },
		],
		critics: [new BinaryCritic({ field: "message" })],
	});

	// Case 2: Reverse a string
	suite.addCase({
		name: "Reverse a word",
		userMessage: 'Reverse the text "arcade"',
		expectedToolCalls: [{ toolName: "reverse", args: { text: "arcade" } }],
		critics: [new BinaryCritic({ field: "text" })],
	});

	// Auto-detect provider from environment
	const { client, model, provider } = await resolveClient();

	const results = await suite.run({
		client,
		model,
		provider,
	});

	// Print results
	console.log(`\nSuite: ${results.suiteName}`);
	console.log(`Model: ${results.model} (${results.provider})`);
	console.log("─".repeat(50));

	for (const caseResult of results.cases) {
		const { evaluation } = caseResult;
		const status = evaluation.passed
			? evaluation.warning
				? "⚠️  WARN"
				: "✅ PASS"
			: "❌ FAIL";
		console.log(
			`${status}  ${caseResult.name}  (score: ${evaluation.score.toFixed(3)})`,
		);
		if (evaluation.failureReason) {
			console.log(`       Reason: ${evaluation.failureReason}`);
		}
	}
}

async function resolveClient(): Promise<{
	client: unknown;
	model: string;
	provider: ProviderName;
}> {
	if (process.env.ANTHROPIC_API_KEY) {
		const { default: Anthropic } = await import("@anthropic-ai/sdk");
		return {
			client: new Anthropic(),
			model: "claude-sonnet-4-20250514",
			provider: "anthropic",
		};
	}
	const { default: OpenAI } = await import("openai");
	return {
		client: new OpenAI(),
		model: "gpt-4o-mini",
		provider: "openai",
	};
}

main().catch(console.error);
