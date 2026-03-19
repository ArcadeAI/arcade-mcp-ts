import { createLogger } from "../logger.js";
import type { CallNext, MiddlewareContext } from "../types.js";
import { Middleware } from "./base.js";

const logger = createLogger("arcade-mcp-middleware");

/**
 * Logging middleware. Logs request/response timing and errors.
 */
export class LoggingMiddleware extends Middleware {
  private logLevel: string;

  constructor(logLevel = "INFO") {
    super();
    this.logLevel = logLevel.toLowerCase();
  }

  override async onMessage(
    context: MiddlewareContext,
    next: CallNext,
  ): Promise<unknown> {
    const start = performance.now();

    this.logRequest(context);

    try {
      const result = await next(context);
      const elapsed = performance.now() - start;
      this.logResponse(context, result, elapsed);
      return result;
    } catch (error) {
      const elapsed = performance.now() - start;
      this.logError(context, error, elapsed);
      throw error;
    }
  }

  private logRequest(context: MiddlewareContext): void {
    const meta = {
      type: context.type,
      method: context.method,
      requestId: context.requestId,
      sessionId: context.sessionId,
    };

    switch (this.logLevel) {
      case "debug":
        logger.debug(meta, `[${context.type.toUpperCase()}] ${context.method}`);
        break;
      default:
        logger.info(meta, `[${context.type.toUpperCase()}] ${context.method}`);
    }
  }

  private logResponse(
    context: MiddlewareContext,
    _result: unknown,
    elapsed: number,
  ): void {
    logger.info(
      {
        method: context.method,
        requestId: context.requestId,
        elapsed: `${elapsed.toFixed(1)}ms`,
      },
      `[RESPONSE] ${context.method}`,
    );
  }

  private logError(
    context: MiddlewareContext,
    error: unknown,
    elapsed: number,
  ): void {
    const errorName =
      error instanceof Error ? error.constructor.name : "UnknownError";
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error(
      {
        method: context.method,
        requestId: context.requestId,
        elapsed: `${elapsed.toFixed(1)}ms`,
        error: `${errorName}: ${errorMessage}`,
      },
      `[ERROR] ${context.method}`,
    );
  }
}
