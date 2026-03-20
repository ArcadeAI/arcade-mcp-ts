import type { ToolCatalog } from "../catalog.js";
import { ServerError } from "../exceptions.js";
import { EvalCase } from "./case.js";
import type { Critic } from "./critics.js";
import { EvalToolRegistry } from "./tool-registry.js";
import type {
  ActualToolCall,
  EvalCaseOptions,
  EvalCaseResult,
  EvalMessage,
  EvalRubric,
  EvalRunOptions,
  EvalSuiteResult,
  EvalToolDefinition,
  ProviderName,
} from "./types.js";

/**
 * An evaluation suite — a collection of eval cases run against an LLM.
 */
export class EvalSuite {
  readonly name: string;
  readonly systemMessage: string;
  readonly rubric?: EvalRubric;
  readonly maxConcurrent: number;

  private registry = new EvalToolRegistry();
  private cases: EvalCase[] = [];

  constructor(options: {
    name: string;
    systemMessage: string;
    rubric?: EvalRubric;
    maxConcurrent?: number;
  }) {
    this.name = options.name;
    this.systemMessage = options.systemMessage;
    this.rubric = options.rubric;
    this.maxConcurrent = options.maxConcurrent ?? 5;
  }

  /**
   * Register MCP-style tool definitions.
   */
  addToolDefinitions(tools: EvalToolDefinition[]): this {
    this.registry.addTools(tools);
    return this;
  }

  /**
   * Register all tools from a ToolCatalog.
   */
  addFromCatalog(catalog: ToolCatalog): this {
    this.registry.addFromCatalog(catalog);
    return this;
  }

  /**
   * Add an evaluation case to the suite.
   */
  addCase(options: EvalCaseOptions): void {
    this.cases.push(
      new EvalCase({
        name: options.name,
        userMessage: options.userMessage,
        expectedToolCalls: options.expectedToolCalls,
        critics: options.critics,
        systemMessage: options.systemMessage ?? this.systemMessage,
        rubric: options.rubric,
        additionalMessages: options.additionalMessages,
      }),
    );
  }

  /**
   * Get the tool registry for inspection.
   */
  getRegistry(): EvalToolRegistry {
    return this.registry;
  }

  /**
   * Run all cases against an LLM.
   */
  async run(options: EvalRunOptions): Promise<EvalSuiteResult> {
    const provider = options.provider ?? detectProvider(options.client);
    const numRuns = options.numRuns ?? 1;

    const results: EvalCaseResult[] = [];

    // Simple semaphore for concurrency control
    const semaphore = createSemaphore(this.maxConcurrent);

    const tasks = this.cases.map((evalCase) => async () => {
      const release = await semaphore.acquire();
      try {
        // Run the case numRuns times, take the last result
        let lastResult: EvalCaseResult | undefined;
        for (let run = 0; run < numRuns; run++) {
          const actualToolCalls = await this.executeCase(
            evalCase,
            options.client,
            options.model,
            provider,
            options.seed,
          );
          const evaluation = evalCase.evaluate(actualToolCalls, this.rubric);
          lastResult = {
            name: evalCase.name,
            evaluation,
            actualToolCalls,
          };
        }
        return lastResult!;
      } finally {
        release();
      }
    });

    const taskResults = await Promise.all(tasks.map((t) => t()));
    results.push(...taskResults);

    return {
      suiteName: this.name,
      model: options.model,
      provider,
      cases: results,
    };
  }

  private async executeCase(
    evalCase: EvalCase,
    client: unknown,
    model: string,
    provider: ProviderName,
    seed?: number,
  ): Promise<ActualToolCall[]> {
    const tools = this.registry.listToolsForModel(provider);

    if (provider === "openai") {
      return this.executeOpenAI(evalCase, client, model, tools, seed);
    }
    return this.executeAnthropic(evalCase, client, model, tools);
  }

  private async executeOpenAI(
    evalCase: EvalCase,
    client: unknown,
    model: string,
    tools: Record<string, unknown>[],
    seed?: number,
  ): Promise<ActualToolCall[]> {
    const messages = buildOpenAIMessages(evalCase);

    // biome-ignore lint/suspicious/noExplicitAny: OpenAI client type varies
    const openai = client as any;
    const response = await openai.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: "auto",
      ...(seed !== undefined ? { seed } : {}),
    });

    const toolCalls: ActualToolCall[] = [];
    const choice = response.choices?.[0];
    if (choice?.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        toolCalls.push({
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments),
        });
      }
    }
    return toolCalls;
  }

  private async executeAnthropic(
    evalCase: EvalCase,
    client: unknown,
    model: string,
    tools: Record<string, unknown>[],
  ): Promise<ActualToolCall[]> {
    const { system, messages } = buildAnthropicMessages(evalCase);

    // biome-ignore lint/suspicious/noExplicitAny: Anthropic client type varies
    const anthropic = client as any;
    const response = await anthropic.messages.create({
      model,
      system,
      messages,
      tools,
      max_tokens: 4096,
    });

    const toolCalls: ActualToolCall[] = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        toolCalls.push({
          name: block.name,
          args: (block.input ?? {}) as Record<string, unknown>,
        });
      }
    }
    return toolCalls;
  }
}

// ── Message builders ────────────────────────────────────

function buildOpenAIMessages(evalCase: EvalCase): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];

  if (evalCase.systemMessage) {
    messages.push({ role: "system", content: evalCase.systemMessage });
  }

  for (const msg of evalCase.additionalMessages) {
    messages.push({ role: msg.role, content: msg.content });
  }

  messages.push({ role: "user", content: evalCase.userMessage });
  return messages;
}

function buildAnthropicMessages(evalCase: EvalCase): {
  system: string;
  messages: Record<string, unknown>[];
} {
  const messages: Record<string, unknown>[] = [];

  for (const msg of evalCase.additionalMessages) {
    messages.push({ role: msg.role, content: msg.content });
  }

  messages.push({ role: "user", content: evalCase.userMessage });

  return {
    system: evalCase.systemMessage ?? "",
    messages,
  };
}

// ── Provider detection ──────────────────────────────────

function detectProvider(client: unknown): ProviderName {
  if (client == null) {
    throw new ServerError("Client is required");
  }

  const clientObj = client as Record<string, unknown>;

  // OpenAI client has `chat` property
  if ("chat" in clientObj) return "openai";

  // Anthropic client has `messages` property
  if ("messages" in clientObj) return "anthropic";

  throw new ServerError(
    "Could not detect provider from client. Pass `provider` explicitly.",
  );
}

// ── Concurrency helper ──────────────────────────────────

function createSemaphore(limit: number) {
  let active = 0;
  const queue: (() => void)[] = [];

  return {
    async acquire(): Promise<() => void> {
      if (active < limit) {
        active++;
        return () => {
          active--;
          if (queue.length > 0) {
            active++;
            queue.shift()!();
          }
        };
      }

      return new Promise<() => void>((resolve) => {
        queue.push(() => {
          resolve(() => {
            active--;
            if (queue.length > 0) {
              active++;
              queue.shift()!();
            }
          });
        });
      });
    },
  };
}
