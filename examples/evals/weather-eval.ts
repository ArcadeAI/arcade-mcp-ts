/**
 * Example eval: Weather tool evaluation using ToolCatalog.
 *
 * Demonstrates:
 * - Adding tools from a ToolCatalog (like a real MCP server would)
 * - Using BinaryCritic and NumericCritic together
 * - Multiple expected tool calls
 *
 * Usage (OpenAI):
 *   OPENAI_API_KEY=sk-... bun run examples/evals/weather-eval.ts
 *
 * Usage (Anthropic):
 *   ANTHROPIC_API_KEY=sk-ant-... bun run examples/evals/weather-eval.ts
 */
import { z } from "zod";
import { ToolCatalog } from "../../src/catalog.js";
import type { ProviderName } from "../../src/evals/index.js";
import {
	BinaryCritic,
	EvalSuite,
	NumericCritic,
	SimilarityCritic,
} from "../../src/evals/index.js";

async function main() {
	// Build a ToolCatalog with weather tools (simulating a real toolkit)
	const catalog = new ToolCatalog();

	catalog.addTool(
		"get_current_weather",
		{
			description:
				"Get the current weather for a city. Returns temperature and conditions.",
			parameters: z.object({
				city: z.string().describe("City name"),
				units: z
					.enum(["celsius", "fahrenheit"])
					.optional()
					.describe("Temperature units"),
			}),
		},
		async (args) => ({
			city: args.city,
			temperature: 72,
			units: args.units ?? "fahrenheit",
			conditions: "sunny",
		}),
		{ name: "Weather" },
	);

	catalog.addTool(
		"get_forecast",
		{
			description: "Get a multi-day weather forecast for a city.",
			parameters: z.object({
				city: z.string().describe("City name"),
				days: z.number().describe("Number of forecast days (1-7)"),
			}),
		},
		async (args) => ({
			city: args.city,
			days: args.days,
			forecast: [],
		}),
		{ name: "Weather" },
	);

	// Create eval suite
	const suite = new EvalSuite({
		name: "Weather Tools Evaluation",
		systemMessage:
			"You are a weather assistant. Use the available tools to answer weather questions. Default to fahrenheit unless the user specifies otherwise.",
		rubric: { failThreshold: 0.8, warnThreshold: 0.9 },
	});

	suite.addFromCatalog(catalog);

	// Case 1: Simple weather lookup
	suite.addCase({
		name: "Current weather in London",
		userMessage: "What's the weather like in London right now?",
		expectedToolCalls: [
			{
				toolName: "Weather_get_current_weather",
				args: { city: "London" },
			},
		],
		critics: [new BinaryCritic({ field: "city" })],
	});

	// Case 2: Weather with specific units
	suite.addCase({
		name: "Weather in Tokyo in Celsius",
		userMessage:
			"What's the current temperature in Tokyo? Give it to me in celsius.",
		expectedToolCalls: [
			{
				toolName: "Weather_get_current_weather",
				args: { city: "Tokyo", units: "celsius" },
			},
		],
		critics: [
			new BinaryCritic({ field: "city" }),
			new BinaryCritic({ field: "units" }),
		],
	});

	// Case 3: Forecast with specific days
	suite.addCase({
		name: "5-day forecast for Paris",
		userMessage: "Give me a 5 day forecast for Paris",
		expectedToolCalls: [
			{
				toolName: "Weather_get_forecast",
				args: { city: "Paris", days: 5 },
			},
		],
		critics: [
			new SimilarityCritic({
				field: "city",
				similarityThreshold: 0.8,
			}),
			new NumericCritic({
				field: "days",
				valueRange: [1, 7],
				matchThreshold: 0.9,
			}),
		],
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
	console.log(`Tools: ${suite.getRegistry().toolNames().join(", ")}`);
	console.log("─".repeat(60));

	let passed = 0;
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
		if (caseResult.actualToolCalls.length > 0) {
			for (const tc of caseResult.actualToolCalls) {
				console.log(`       Called: ${tc.name}(${JSON.stringify(tc.args)})`);
			}
		}
		if (evaluation.passed) passed++;
	}

	console.log("─".repeat(60));
	console.log(`Results: ${passed}/${results.cases.length} passed`);
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
