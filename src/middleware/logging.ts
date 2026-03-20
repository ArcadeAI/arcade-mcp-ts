import type { Logger } from "pino";
import { createLogger } from "../logger.js";
import type { CallNext, MiddlewareContext } from "../types.js";
import { Middleware } from "./base.js";

const defaultLogger = createLogger("arcade-mcp-middleware");

/**
 * Logging middleware. Emits a single combined log line per request with method, timing, and status.
 */
export class LoggingMiddleware extends Middleware {
  private logLevel: string;
  private logger: Logger;

  constructor(logLevel = "INFO", logger?: Logger) {
    super();
    this.logLevel = logLevel.toLowerCase();
    this.logger = logger ?? defaultLogger;
  }

  override async onMessage(
    context: MiddlewareContext,
    next: CallNext,
  ): Promise<unknown> {
    const start = performance.now();

    try {
      const result = await next(context);
      const elapsed = performance.now() - start;
      this.logCompleted(context, elapsed);
      return result;
    } catch (error) {
      const elapsed = performance.now() - start;
      this.logCompleted(context, elapsed, error);
      throw error;
    }
  }

  private logCompleted(
    context: MiddlewareContext,
    elapsed: number,
    error?: unknown,
  ): void {
    const meta: Record<string, unknown> = {
      method: context.method,
      requestId: context.requestId,
      sessionId: context.sessionId,
      elapsed: `${elapsed.toFixed(1)}ms`,
    };

    if (error) {
      const errorName =
        error instanceof Error ? error.constructor.name : "UnknownError";
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      meta.error = `${errorName}: ${errorMessage}`;
      this.logger.error(meta, `${context.method} ${meta.elapsed}`);
    } else if (this.logLevel === "debug") {
      this.logger.debug(meta, `${context.method} ${meta.elapsed}`);
    } else {
      this.logger.info(meta, `${context.method} ${meta.elapsed}`);
    }
  }
}
