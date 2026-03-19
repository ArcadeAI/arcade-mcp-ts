import type {
  CallToolResult,
  ServerNotification,
} from "@modelcontextprotocol/sdk/types.js";
import type { ToolAuthorization } from "./auth/types.js";
import { RetryableToolError, ToolResponseExtractionError } from "./errors.js";
import { AuthorizationError, NotFoundError } from "./exceptions.js";
import { createLogger } from "./logger.js";
import type { ServerSession } from "./session.js";
import type { MCPSettings } from "./settings.js";
import {
  EXECUTE_DEFAULTS,
  type ExecuteOptions,
  makeNullable,
  OnMissing,
  structureOutput,
} from "./structuring.js";
import type { ResourceOwner } from "./types.js";

/**
 * The RequestHandlerExtra type from MCP SDK, parameterized for server usage.
 */
// biome-ignore lint/suspicious/noExplicitAny: SDK generic requires flexible typing
export type ServerExtra = Record<string, any> & {
  signal: AbortSignal;
  authInfo?: unknown;
  sessionId?: string;
  requestId?: string | number;
  sendNotification?: (notification: ServerNotification) => Promise<void>;
  sendRequest?: (...args: unknown[]) => Promise<unknown>;
};

const logger = createLogger("arcade-mcp");

/**
 * Current context for the active request — enables get_current_context() pattern.
 */
let _currentContext: Context | null = null;

export function getCurrentContext(): Context | null {
  return _currentContext;
}

export function setCurrentContext(ctx: Context | null): Context | null {
  const prev = _currentContext;
  _currentContext = ctx;
  return prev;
}

/**
 * Tool context carrying auth, secrets, and user info for a single tool execution.
 */
export interface ToolContextData {
  authorization?: ToolAuthorization;
  authToken?: string;
  secrets: Record<string, string>;
  metadata: Record<string, unknown>;
  userId?: string;
}

/**
 * Interface that the server implements to allow Context.tools to call tools.
 * Avoids a direct dependency from context.ts -> server.ts.
 */
export interface ToolExecutor {
  /** Execute a tool through the full middleware + auth pipeline. */
  executeToolByName(
    name: string,
    args: Record<string, unknown>,
    extra: ServerExtra,
  ): Promise<CallToolResult>;
  /** Get the Arcade Cloud client (if configured). */
  getArcadeClient(): unknown | undefined;
  /** Get settings. */
  getSettings(): MCPSettings | undefined;
  /** Check if a tool exists in the catalog. */
  hasToolInCatalog(name: string): boolean;
}

/**
 * Context wraps MCP SDK's RequestHandlerExtra and adds Arcade features.
 * Tool handlers receive (args, context: Context).
 */
export class Context {
  readonly log: Logs;
  readonly progress: Progress;
  readonly resources: Resources;
  readonly tools: Tools;
  readonly sampling: Sampling;
  readonly ui: UI;
  readonly prompts: Prompts;
  readonly notifications: Notifications;

  private _extra: ServerExtra;
  private _toolContext: ToolContextData;
  private _resourceOwner?: ResourceOwner;
  private _requestId: string;
  private _sessionId?: string;
  private _serverSession?: ServerSession;
  private _toolExecutor?: ToolExecutor;

  constructor(
    extra: ServerExtra,
    options?: {
      requestId?: string;
      sessionId?: string;
      resourceOwner?: ResourceOwner;
      toolContext?: ToolContextData;
      serverSession?: ServerSession;
      toolExecutor?: ToolExecutor;
    },
  ) {
    this._extra = extra;
    this._requestId = options?.requestId ?? crypto.randomUUID();
    this._sessionId = options?.sessionId;
    this._resourceOwner = options?.resourceOwner;
    this._serverSession = options?.serverSession;
    this._toolContext = options?.toolContext ?? {
      secrets: {},
      metadata: {},
    };
    this._toolExecutor = options?.toolExecutor;

    // Initialize facades
    this.log = new Logs(this);
    this.progress = new Progress(this);
    this.resources = new Resources(this);
    this.tools = new Tools(this);
    this.sampling = new Sampling(this);
    this.ui = new UI(this);
    this.prompts = new Prompts(this);
    this.notifications = new Notifications(this);
  }

  get signal(): AbortSignal {
    return this._extra.signal;
  }

  get sessionId(): string | undefined {
    return this._sessionId;
  }

  get requestId(): string {
    return this._requestId;
  }

  get resourceOwner(): ResourceOwner | undefined {
    return this._resourceOwner;
  }

  get userId(): string | undefined {
    return this._resourceOwner?.userId ?? this._toolContext.userId;
  }

  get extra(): ServerExtra {
    return this._extra;
  }

  get serverSession(): ServerSession | undefined {
    return this._serverSession;
  }

  get toolExecutor(): ToolExecutor | undefined {
    return this._toolExecutor;
  }

  /**
   * Get a secret by name. Throws if missing.
   */
  getSecret(name: string): string {
    const value = this._toolContext.secrets[name];
    if (value === undefined) {
      throw new NotFoundError(`Secret '${name}' not found in context`);
    }
    return value;
  }

  /**
   * Get the auth token. Throws if missing.
   */
  getAuthToken(): string {
    const token = this._toolContext.authToken;
    if (!token) {
      throw new AuthorizationError("Auth token not found in context");
    }
    return token;
  }

  /**
   * Get the auth token, returning empty string if missing.
   */
  getAuthTokenOrEmpty(): string {
    return this._toolContext.authToken ?? "";
  }

  /**
   * Set tool-specific context (auth, secrets, etc).
   */
  setToolContext(data: ToolContextData): void {
    this._toolContext = data;
  }

  /**
   * Get current tool context data (for save/restore).
   */
  getToolContext(): ToolContextData {
    return { ...this._toolContext };
  }

  /**
   * Send a notification via the MCP session.
   * @deprecated Use context.notifications.send() instead.
   */
  async sendNotification(notification: ServerNotification): Promise<void> {
    await this.notifications.send(notification);
  }
}

/**
 * Base class for context facades.
 */
class ContextComponent {
  constructor(protected ctx: Context) {}
}

/**
 * Logging facade: context.log.info(), .debug(), .warning(), .error()
 */
export class Logs extends ContextComponent {
  info(message: string, extra?: Record<string, unknown>): void {
    logger.info({ requestId: this.ctx.requestId, ...extra }, message);
  }

  debug(message: string, extra?: Record<string, unknown>): void {
    logger.debug({ requestId: this.ctx.requestId, ...extra }, message);
  }

  warning(message: string, extra?: Record<string, unknown>): void {
    logger.warn({ requestId: this.ctx.requestId, ...extra }, message);
  }

  error(message: string, extra?: Record<string, unknown>): void {
    logger.error({ requestId: this.ctx.requestId, ...extra }, message);
  }
}

/**
 * Progress reporting facade: context.progress.report()
 */
export class Progress extends ContextComponent {
  async report(
    progress: number,
    total?: number,
    message?: string,
  ): Promise<void> {
    // Send progress notification via MCP protocol
    try {
      await this.ctx.extra.sendNotification?.({
        method: "notifications/progress" as never,
        params: {
          progress,
          total,
          message,
        } as never,
      });
    } catch {
      // Best-effort progress reporting
    }
  }
}

/**
 * Resource access facade: context.resources.read(), .list()
 */
export class Resources extends ContextComponent {
  async read(_uri: string): Promise<unknown> {
    // Delegate to server's resource handler via extra
    return undefined;
  }

  async list(): Promise<unknown[]> {
    return [];
  }
}

/**
 * Tool calling facade: context.tools.call(), .callRaw(), .execute()
 */
export class Tools extends ContextComponent {
  /**
   * Call a tool by name and return the raw result.
   */
  async call(
    name: string,
    params?: Record<string, unknown>,
  ): Promise<CallToolResult | undefined> {
    return this.callRaw(name, params ?? {});
  }

  /**
   * List available tools.
   */
  async list(): Promise<unknown[]> {
    return [];
  }

  /**
   * Call a tool and return the raw CallToolResult.
   * Falls back to Arcade Cloud if the tool is not found locally.
   */
  async callRaw(
    name: string,
    params: Record<string, unknown>,
  ): Promise<CallToolResult> {
    const executor = this.ctx.toolExecutor;
    if (!executor) {
      logger.warn("[callRaw] No toolExecutor — tool=%s", name);
      return {
        content: [
          {
            type: "text" as const,
            text: "Tool execution not available: no server reference in context",
          },
        ],
        isError: true,
      };
    }

    // Try local execution first
    if (executor.hasToolInCatalog(name)) {
      logger.debug("[callRaw] Executing locally — tool=%s", name);
      const result = await executor.executeToolByName(
        name,
        params,
        this.ctx.extra,
      );
      logger.debug(
        "[callRaw] Local result — tool=%s isError=%s contentTypes=%s",
        name,
        result.isError,
        result.content.map((c) => c.type).join(","),
      );
      return result;
    }

    // Not found locally — try Arcade Cloud
    const arcade = executor.getArcadeClient();
    if (arcade) {
      logger.debug("[callRaw] Not local, calling remote — tool=%s", name);
      const start = Date.now();
      const result = await this._callRemote(name, params);
      logger.debug(
        "[callRaw] Remote result — tool=%s isError=%s elapsed=%dms",
        name,
        result.isError,
        Date.now() - start,
      );
      return result;
    }

    logger.warn(
      "[callRaw] Tool not found and no Arcade client — tool=%s",
      name,
    );
    return {
      content: [
        {
          type: "text" as const,
          text: `Tool '${name}' not found locally and no Arcade client configured`,
        },
      ],
      isError: true,
    };
  }

  /**
   * Execute a tool via Arcade Cloud when it's not available locally.
   */
  private async _callRemote(
    name: string,
    params: Record<string, unknown>,
  ): Promise<CallToolResult> {
    const executor = this.ctx.toolExecutor!;
    // biome-ignore lint/suspicious/noExplicitAny: Arcade SDK type
    const arcade = executor.getArcadeClient() as any;

    // Arcade Cloud uses dot notation (e.g., "Gmail.ListEmails")
    const remoteName = name.includes(".") ? name : name.replace("_", ".");
    const userId = this.ctx.userId ?? "anonymous";

    try {
      const response = await arcade.tools.execute({
        tool_name: remoteName,
        input: params,
        user_id: userId,
      });

      if (
        response.success &&
        response.output &&
        response.output.value !== null &&
        response.output.value !== undefined
      ) {
        const value = response.output.value;
        const text = typeof value === "string" ? value : JSON.stringify(value);
        const structured =
          typeof value === "object" && !Array.isArray(value)
            ? value
            : { result: value };

        return {
          content: [{ type: "text" as const, text }],
          structuredContent: structured as Record<string, unknown>,
          isError: false,
        };
      }

      const errorMsg = response.output?.error
        ? String(response.output.error)
        : "Remote tool execution failed";
      return {
        content: [{ type: "text" as const, text: errorMsg }],
        structuredContent: { error: errorMsg },
        isError: true,
      };
    } catch (err: unknown) {
      // Check for 403 auth required
      const status =
        (err as { status_code?: number; statusCode?: number }).status_code ??
        (err as { statusCode?: number }).statusCode;
      const body = (err as { body?: unknown }).body;

      if (
        status === 403 &&
        body &&
        String(body).includes("tool_authorization_required")
      ) {
        return this._handleRemoteAuth(remoteName, userId);
      }

      const errorMsg = `Failed to call remote tool '${remoteName}': ${err instanceof Error ? err.message : String(err)}`;
      return {
        content: [{ type: "text" as const, text: errorMsg }],
        structuredContent: { error: errorMsg },
        isError: true,
      };
    }
  }

  /**
   * Handle authorization required for a remote Arcade Cloud tool.
   */
  private async _handleRemoteAuth(
    toolName: string,
    userId: string,
  ): Promise<CallToolResult> {
    const executor = this.ctx.toolExecutor!;
    // biome-ignore lint/suspicious/noExplicitAny: Arcade SDK type
    const arcade = executor.getArcadeClient() as any;

    try {
      const authResponse = await arcade.tools.authorize({
        tool_name: toolName,
        user_id: userId,
      });

      if (authResponse.status === "completed") {
        return {
          content: [
            {
              type: "text" as const,
              text: `Authorization for '${toolName}' is already complete. Please retry.`,
            },
          ],
          isError: true,
        };
      }

      const userMessage =
        `Authorization required\n\n` +
        `Tool '${toolName}' needs your permission to access your account.\n\n` +
        `To authorize:\n` +
        `1. Click this link: ${authResponse.url}\n` +
        `2. Grant the requested permissions\n` +
        `3. Return here and try again\n\n` +
        `This is a one-time setup for this tool.`;

      return {
        content: [{ type: "text" as const, text: userMessage }],
        structuredContent: {
          error: userMessage,
          message: userMessage,
          llm_instructions: `Please show the following link to the end user formatted as markdown: ${authResponse.url} \nInform the end user that the tool requires their authorization to be completed before the tool can be executed.`,
          authorization_url: authResponse.url,
        },
        isError: true,
      };
    } catch (err) {
      const errorMsg = `Failed to authorize remote tool '${toolName}': ${err instanceof Error ? err.message : String(err)}`;
      return {
        content: [{ type: "text" as const, text: errorMsg }],
        structuredContent: { error: errorMsg },
        isError: true,
      };
    }
  }

  /**
   * Call a tool and structure the result into a typed Zod schema.
   *
   * Uses a tiered strategy:
   *   1. Direct Zod validation
   *   2. Heuristic field mapping (key normalization, unwrapping)
   *   3. LLM extraction via MCP sampling (if client supports it)
   *   3b. Anthropic SDK fallback (if configured)
   */
  async execute<T extends import("zod").ZodObject<import("zod").ZodRawShape>>(
    schema: T,
    toolName: string,
    args: Record<string, unknown>,
    options?: ExecuteOptions,
  ): Promise<import("zod").infer<T>> {
    const opts = { ...EXECUTE_DEFAULTS, ...options };
    const { onMissing, maxRetries, retryDelaySeconds } = opts;
    const executeStart = Date.now();

    logger.debug(
      "[execute] Starting — tool=%s onMissing=%s maxRetries=%d",
      toolName,
      onMissing,
      maxRetries,
    );

    let lastError: Error | undefined;

    // Send periodic progress notifications to keep the SSE stream alive
    // during long-running cross-tool calls. Without these, clients may
    // close the connection due to inactivity.
    const KEEPALIVE_INTERVAL_MS = 5_000;
    let keepaliveTimer: ReturnType<typeof setInterval> | undefined;
    let progressTick = 0;
    const startKeepalive = () => {
      if (keepaliveTimer) return;
      keepaliveTimer = setInterval(() => {
        progressTick++;
        this.ctx.progress
          .report(progressTick, undefined, `Executing ${toolName}...`)
          .catch(() => {});
      }, KEEPALIVE_INTERVAL_MS);
    };
    const stopKeepalive = () => {
      if (keepaliveTimer) {
        clearInterval(keepaliveTimer);
        keepaliveTimer = undefined;
      }
    };

    startKeepalive();
    try {
      return await this._executeInner(
        schema,
        toolName,
        args,
        opts,
        maxRetries,
        retryDelaySeconds,
        onMissing,
        executeStart,
      );
    } finally {
      stopKeepalive();
    }
  }

  /**
   * Inner execute loop, separated to allow keepalive wrapping.
   */
  private async _executeInner<
    T extends import("zod").ZodObject<import("zod").ZodRawShape>,
  >(
    schema: T,
    toolName: string,
    args: Record<string, unknown>,
    opts: Required<ExecuteOptions>,
    maxRetries: number,
    retryDelaySeconds: number,
    onMissing: OnMissing,
    executeStart: number,
  ): Promise<import("zod").infer<T>> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Step 1: Call the tool
        logger.debug(
          "[execute] Attempt %d/%d — calling tool=%s",
          attempt + 1,
          maxRetries + 1,
          toolName,
        );
        const callStart = Date.now();
        const rawResult = await this.callRaw(toolName, args);
        logger.debug(
          "[execute] callRaw complete — tool=%s elapsed=%dms isError=%s",
          toolName,
          Date.now() - callStart,
          rawResult.isError,
        );

        if (rawResult.isError) {
          logger.debug(
            "[execute] Tool returned error — tool=%s content=%s",
            toolName,
            extractText(rawResult).slice(0, 200),
          );
          raiseToolError(toolName, rawResult);
        }

        // Step 2: Try deterministic structuring (Tiers 1-2)
        const rawData =
          rawResult.structuredContent ?? parseTextContent(rawResult);
        logger.debug(
          "[execute] Structuring — tool=%s hasStructuredContent=%s hasRawData=%s",
          toolName,
          !!rawResult.structuredContent,
          rawData !== undefined,
        );
        let tier12Result: import("zod").infer<T> | undefined;

        if (rawData !== undefined) {
          try {
            tier12Result = structureOutput(schema, rawData, onMissing);
            // If ALLOW_NULL left some fields as null, prefer Tier 3
            if (
              onMissing === OnMissing.ALLOW_NULL &&
              hasNullFields(tier12Result)
            ) {
              logger.debug(
                "[execute] Tier 1-2 succeeded with null fields, trying Tier 3 — tool=%s",
                toolName,
              );
            } else {
              logger.debug(
                "[execute] Tier 1-2 succeeded — tool=%s elapsed=%dms",
                toolName,
                Date.now() - executeStart,
              );
              return tier12Result;
            }
          } catch (structErr) {
            logger.debug(
              "[execute] Tier 1-2 failed — tool=%s error=%s",
              toolName,
              structErr,
            );
          }
        }

        // Step 3: LLM extraction via MCP sampling
        logger.debug("[execute] Trying Tier 3a (sampling) — tool=%s", toolName);
        try {
          const samplingStart = Date.now();
          const result = await this._extractViaSampling(
            schema,
            rawResult,
            onMissing,
          );
          logger.debug(
            "[execute] Tier 3a succeeded — tool=%s elapsed=%dms",
            toolName,
            Date.now() - samplingStart,
          );
          return result;
        } catch (samplingErr) {
          // Check if sampling is unavailable (not just failed)
          const errMsg = String(samplingErr);
          logger.debug(
            "[execute] Tier 3a failed — tool=%s error=%s",
            toolName,
            errMsg.slice(0, 200),
          );
          const unavailable =
            errMsg.includes("not available") ||
            errMsg.includes("not supported") ||
            errMsg.includes("Session not available") ||
            errMsg.includes("Method not found");

          if (unavailable) {
            // Try Anthropic SDK fallback
            logger.debug(
              "[execute] Trying Tier 3b (Anthropic) — tool=%s",
              toolName,
            );
            try {
              const anthropicStart = Date.now();
              const result = await this._extractViaAnthropic(
                schema,
                rawResult,
                onMissing,
              );
              logger.debug(
                "[execute] Tier 3b succeeded — tool=%s elapsed=%dms",
                toolName,
                Date.now() - anthropicStart,
              );
              return result;
            } catch (anthropicErr) {
              logger.debug(
                "[execute] Tier 3b failed — tool=%s error=%s",
                toolName,
                anthropicErr,
              );
              // All LLM paths failed — use partial result or empty
              if (tier12Result !== undefined) {
                logger.debug(
                  "[execute] Falling back to partial Tier 1-2 result — tool=%s",
                  toolName,
                );
                return tier12Result;
              }
              if (onMissing === OnMissing.ALLOW_NULL) {
                logger.debug(
                  "[execute] All tiers failed, returning nullable empty — tool=%s elapsed=%dms",
                  toolName,
                  Date.now() - executeStart,
                );
                return makeNullable(schema).parse({});
              }
              throw new ToolResponseExtractionError(
                `All extraction tiers failed for '${toolName}'`,
              );
            }
          }

          // Sampling was available but failed
          if (tier12Result !== undefined) return tier12Result;
          if (onMissing === OnMissing.ALLOW_NULL) {
            return makeNullable(schema).parse({});
          }
          throw samplingErr;
        }
      } catch (err) {
        if (err instanceof ToolResponseExtractionError) {
          logger.error(
            "[execute] Non-retryable error — tool=%s elapsed=%dms error=%s",
            toolName,
            Date.now() - executeStart,
            err.message,
          );
          throw err;
        }
        if (err instanceof RetryableToolError && attempt < maxRetries) {
          lastError = err;
          logger.debug(
            "[execute] Retryable error, waiting %ds — tool=%s attempt=%d error=%s",
            retryDelaySeconds,
            toolName,
            attempt + 1,
            err.message,
          );
          await sleep(retryDelaySeconds * 1000);
          continue;
        }
        if (
          (err instanceof SyntaxError || err instanceof TypeError) &&
          attempt < maxRetries
        ) {
          lastError = err as Error;
          logger.debug(
            "[execute] Parse error, retrying — tool=%s attempt=%d error=%s",
            toolName,
            attempt + 1,
            (err as Error).message,
          );
          await sleep(retryDelaySeconds * 1000);
          continue;
        }
        logger.error(
          "[execute] Unhandled error — tool=%s elapsed=%dms error=%s",
          toolName,
          Date.now() - executeStart,
          err,
        );
        throw err;
      }
    }

    logger.error(
      "[execute] All attempts exhausted — tool=%s elapsed=%dms",
      toolName,
      Date.now() - executeStart,
    );
    throw new ToolResponseExtractionError(
      `Failed to extract response after ${maxRetries + 1} attempts`,
      { developerMessage: lastError?.message },
    );
  }

  /**
   * Tier 3a: Use MCP sampling to extract structured data from raw tool output.
   */
  private async _extractViaSampling<
    T extends import("zod").ZodObject<import("zod").ZodRawShape>,
  >(
    schema: T,
    rawResult: CallToolResult,
    onMissing: OnMissing,
  ): Promise<import("zod").infer<T>> {
    const rawText = extractText(rawResult);
    const jsonSchema = zodToJsonSchema(schema);
    const nullInstruction =
      onMissing === OnMissing.ALLOW_NULL
        ? " If a field's value cannot be determined from the input, use null."
        : "";

    const systemPrompt =
      "You are a data extraction assistant. Extract data from the provided input " +
      "and return ONLY valid JSON matching the given schema. Do not include any " +
      `explanation or markdown formatting.${nullInstruction}\n\n` +
      `Target JSON Schema:\n${JSON.stringify(jsonSchema, null, 2)}`;

    const samplingResult = await this.ctx.sampling.createMessage({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Extract data from this tool output:\n\n${rawText}`,
          },
        },
      ],
      systemPrompt,
      maxTokens: 2048,
    });

    if (samplingResult === undefined) {
      throw new Error("Sampling not available");
    }

    // Parse LLM response
    const responseText =
      typeof samplingResult === "string"
        ? samplingResult
        : typeof samplingResult === "object" &&
              samplingResult !== null &&
              "text" in (samplingResult as Record<string, unknown>)
            ? String((samplingResult as Record<string, unknown>).text)
            : JSON.stringify(samplingResult);

    const parsed = JSON.parse(responseText);
    return schema.parse(parsed);
  }

  /**
   * Tier 3b: Use Anthropic SDK to extract structured data from raw tool output.
   */
  private async _extractViaAnthropic<
    T extends import("zod").ZodObject<import("zod").ZodRawShape>,
  >(
    schema: T,
    rawResult: CallToolResult,
    onMissing: OnMissing,
  ): Promise<import("zod").infer<T>> {
    const settings = this.ctx.toolExecutor?.getSettings()?.anthropic;
    if (!settings?.apiKey) {
      throw new ToolResponseExtractionError(
        "Deterministic structuring failed and Anthropic extraction is unavailable: " +
          "ANTHROPIC_API_KEY is not set.",
      );
    }

    // Lazy import Anthropic SDK
    let Anthropic: typeof import("@anthropic-ai/sdk").default;
    try {
      const mod = await import("@anthropic-ai/sdk");
      Anthropic = mod.default;
    } catch {
      throw new ToolResponseExtractionError(
        "Anthropic SDK not installed. Install @anthropic-ai/sdk for Tier 3b extraction.",
      );
    }

    const client = new Anthropic({
      apiKey: settings.apiKey,
      ...(settings.baseUrl ? { baseURL: settings.baseUrl } : {}),
    });

    const rawText = extractText(rawResult);
    const jsonSchema = zodToJsonSchema(schema);
    const nullInstruction =
      onMissing === OnMissing.ALLOW_NULL
        ? " If a field's value cannot be determined from the input, use null."
        : "";

    const toolName = `extract_data`;
    const systemPrompt = `You are a data extraction assistant. Call the provided tool with fields extracted from the user's input.${nullInstruction}`;

    const response = await client.messages.create({
      model: settings.model,
      max_tokens: 2048,
      system: systemPrompt,
      tools: [
        {
          name: toolName,
          description: "Extract structured data from the input.",
          input_schema: {
            type: "object" as const,
            ...jsonSchema,
          },
        },
      ],
      tool_choice: { type: "tool" as const, name: toolName },
      messages: [
        {
          role: "user" as const,
          content: `Extract data from this tool output:\n\n${rawText}`,
        },
      ],
    });

    const toolUseBlock = response.content.find(
      (block) => block.type === "tool_use",
    );
    if (!toolUseBlock || toolUseBlock.type !== "tool_use") {
      throw new ToolResponseExtractionError(
        "Anthropic returned no tool_use block during structured extraction.",
      );
    }

    return schema.parse(toolUseBlock.input);
  }
}

/**
 * Sampling facade: context.sampling.createMessage()
 */
export class Sampling extends ContextComponent {
  async createMessage(options: {
    messages: Array<{
      role: "user" | "assistant";
      content: { type: "text"; text: string };
    }>;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<unknown> {
    const session = this.ctx.serverSession;
    if (session?.isInitialized) {
      return session.createMessage({
        messages: options.messages,
        systemPrompt: options.systemPrompt,
        temperature: options.temperature,
        maxTokens: options.maxTokens ?? 1024,
      });
    }
    return undefined;
  }
}

/**
 * UI facade: context.ui.elicit()
 */
export class UI extends ContextComponent {
  async elicit(
    message: string,
    schema?: Record<string, unknown>,
  ): Promise<unknown> {
    const session = this.ctx.serverSession;
    if (session?.isInitialized) {
      return session.elicitInput({
        message,
        requestedSchema: schema,
      } as never);
    }
    return undefined;
  }
}

/**
 * Prompts facade: context.prompts.get(), .list()
 */
export class Prompts extends ContextComponent {
  async get(
    _name: string,
    _arguments?: Record<string, string>,
  ): Promise<unknown> {
    // Delegate to server's prompt handler via extra
    return undefined;
  }

  async list(): Promise<unknown[]> {
    return [];
  }
}

/**
 * Sub-facade for tool list change notifications.
 */
class _NotificationsTools {
  constructor(private parent: Notifications) {}

  async listChanged(): Promise<void> {
    this.parent.enqueue("notifications/tools/list_changed");
  }
}

/**
 * Sub-facade for resource list change notifications.
 */
class _NotificationsResources {
  constructor(private parent: Notifications) {}

  async listChanged(): Promise<void> {
    this.parent.enqueue("notifications/resources/list_changed");
  }
}

/**
 * Sub-facade for prompt list change notifications.
 */
class _NotificationsPrompts {
  constructor(private parent: Notifications) {}

  async listChanged(): Promise<void> {
    this.parent.enqueue("notifications/prompts/list_changed");
  }
}

/**
 * Notifications facade: context.notifications.send()
 *
 * Provides typed sub-facades for common notification types:
 * - context.notifications.tools.listChanged()
 * - context.notifications.resources.listChanged()
 * - context.notifications.prompts.listChanged()
 *
 * Notifications are deduplicated and flushed in batch at end of request.
 */
export class Notifications extends ContextComponent {
  readonly tools: _NotificationsTools;
  readonly resources: _NotificationsResources;
  readonly prompts: _NotificationsPrompts;

  private _queue = new Set<string>();

  constructor(ctx: Context) {
    super(ctx);
    this.tools = new _NotificationsTools(this);
    this.resources = new _NotificationsResources(this);
    this.prompts = new _NotificationsPrompts(this);
  }

  /**
   * Send an arbitrary notification immediately (not queued).
   */
  async send(notification: ServerNotification): Promise<void> {
    try {
      await this.ctx.extra.sendNotification?.(notification);
    } catch {
      // Best-effort notification delivery
    }
  }

  /**
   * Enqueue a notification method for batched, deduplicated delivery.
   * @internal
   */
  enqueue(method: string): void {
    this._queue.add(method);
  }

  /**
   * Flush all queued notifications. Called automatically at end of request.
   * Safe to call multiple times — second call is a no-op if queue is empty.
   */
  async flush(): Promise<void> {
    if (this._queue.size === 0) return;

    const methods = [...this._queue];
    this._queue.clear();

    for (const method of methods) {
      try {
        await this.ctx.extra.sendNotification?.({
          method,
          params: {},
        } as ServerNotification);
      } catch {
        // Best-effort — don't let notification failures break the request
      }
    }
  }
}

// ── Helpers ──────────────────────────────────────────────

function raiseToolError(toolName: string, rawResult: CallToolResult): never {
  let errorMsg = "Unknown error";
  const structured = rawResult.structuredContent as
    | Record<string, unknown>
    | undefined;
  if (structured) {
    errorMsg = String(
      structured.llm_instructions ?? structured.error ?? errorMsg,
    );
  }
  throw new ToolResponseExtractionError(
    `Tool '${toolName}' returned an error: ${errorMsg}`,
  );
}

function hasNullFields(obj: unknown): boolean {
  if (typeof obj !== "object" || obj === null) return false;
  for (const value of Object.values(obj)) {
    if (value === null) return true;
    if (typeof value === "object" && hasNullFields(value)) return true;
  }
  return false;
}

function parseTextContent(result: CallToolResult): unknown {
  if (!result.content) return undefined;
  for (const item of result.content) {
    if (
      typeof item === "object" &&
      item !== null &&
      "type" in item &&
      item.type === "text" &&
      "text" in item
    ) {
      try {
        return JSON.parse(item.text as string);
      } catch {
        // Not JSON
      }
    }
  }
  return undefined;
}

function extractText(result: CallToolResult): string {
  // Prefer structuredContent
  const structured = result.structuredContent as
    | Record<string, unknown>
    | undefined;
  if (structured) {
    return JSON.stringify(structured);
  }

  const parts: string[] = [];
  if (result.content) {
    for (const item of result.content) {
      if (
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        item.type === "text" &&
        "text" in item
      ) {
        parts.push(item.text as string);
      }
    }
  }
  return parts.join("\n") || "{}";
}

/**
 * Simple Zod-to-JSON-Schema for structuring prompts.
 */
function zodToJsonSchema(
  schema: import("zod").ZodType,
): Record<string, unknown> {
  const def = (schema as unknown as { _def: Record<string, unknown> })._def;

  if (def.typeName === "ZodObject") {
    const shape = (
      schema as unknown as { shape: Record<string, import("zod").ZodType> }
    ).shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value as import("zod").ZodType);
      const innerDef = (value as unknown as { _def: Record<string, unknown> })
        ._def;
      if (
        innerDef.typeName !== "ZodOptional" &&
        innerDef.typeName !== "ZodDefault"
      ) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }

  if (def.typeName === "ZodString") return { type: "string" };
  if (def.typeName === "ZodNumber") return { type: "number" };
  if (def.typeName === "ZodBoolean") return { type: "boolean" };
  if (def.typeName === "ZodArray") {
    return {
      type: "array",
      items: zodToJsonSchema(def.type as import("zod").ZodType),
    };
  }
  if (def.typeName === "ZodOptional" || def.typeName === "ZodNullable") {
    return zodToJsonSchema(def.innerType as import("zod").ZodType);
  }
  if (def.typeName === "ZodDefault") {
    return zodToJsonSchema(def.innerType as import("zod").ZodType);
  }

  return { type: "object" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
