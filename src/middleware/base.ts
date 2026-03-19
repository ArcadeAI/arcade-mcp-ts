import type { CallNext, MiddlewareContext } from "../types.js";

/**
 * Abstract middleware class with method-specific hooks.
 * Override any hook to intercept that request type.
 * Default implementations pass through to the next middleware.
 */
export abstract class Middleware {
  /**
   * Main entry point — builds the handler chain and invokes it.
   */
  async handle(context: MiddlewareContext, next: CallNext): Promise<unknown> {
    // Build chain: onMessage -> onRequest/onNotification -> method-specific
    const chain = this.buildHandlerChain(context, next);
    return chain(context);
  }

  /**
   * Build a nested handler chain for this middleware.
   */
  private buildHandlerChain(
    context: MiddlewareContext,
    next: CallNext,
  ): CallNext {
    // Start with the method-specific handler wrapping `next`
    let handler: CallNext = async (ctx) => {
      const methodHandler = this.getMethodHandler(ctx.method);
      if (methodHandler) {
        return methodHandler.call(this, ctx, next);
      }
      return next(ctx);
    };

    // Wrap with type-level handler
    if (context.type === "request") {
      const requestHandler = handler;
      handler = async (ctx) => this.onRequest(ctx, requestHandler);
    }

    // Wrap with onMessage (always outermost)
    const outerHandler = handler;
    return async (ctx) => this.onMessage(ctx, outerHandler);
  }

  /**
   * Get the method-specific handler for a given MCP method.
   */
  private getMethodHandler(
    method: string,
  ): ((ctx: MiddlewareContext, next: CallNext) => Promise<unknown>) | null {
    switch (method) {
      case "tools/call":
        return this.onCallTool;
      case "tools/list":
        return this.onListTools;
      case "resources/read":
        return this.onReadResource;
      case "resources/list":
        return this.onListResources;
      case "resources/templates/list":
        return this.onListResourceTemplates;
      case "prompts/get":
        return this.onGetPrompt;
      case "prompts/list":
        return this.onListPrompts;
      default:
        return null;
    }
  }

  // ── Override hooks ──────────────────────────────────────────

  /** Runs for every message (outermost). */
  async onMessage(
    context: MiddlewareContext,
    next: CallNext,
  ): Promise<unknown> {
    return next(context);
  }

  /** Runs for all requests (after onMessage). */
  async onRequest(
    context: MiddlewareContext,
    next: CallNext,
  ): Promise<unknown> {
    return next(context);
  }

  /** Runs for tools/call. */
  async onCallTool(
    context: MiddlewareContext,
    next: CallNext,
  ): Promise<unknown> {
    return next(context);
  }

  /** Runs for tools/list. */
  async onListTools(
    context: MiddlewareContext,
    next: CallNext,
  ): Promise<unknown> {
    return next(context);
  }

  /** Runs for resources/read. */
  async onReadResource(
    context: MiddlewareContext,
    next: CallNext,
  ): Promise<unknown> {
    return next(context);
  }

  /** Runs for resources/list. */
  async onListResources(
    context: MiddlewareContext,
    next: CallNext,
  ): Promise<unknown> {
    return next(context);
  }

  /** Runs for resources/templates/list. */
  async onListResourceTemplates(
    context: MiddlewareContext,
    next: CallNext,
  ): Promise<unknown> {
    return next(context);
  }

  /** Runs for prompts/get. */
  async onGetPrompt(
    context: MiddlewareContext,
    next: CallNext,
  ): Promise<unknown> {
    return next(context);
  }

  /** Runs for prompts/list. */
  async onListPrompts(
    context: MiddlewareContext,
    next: CallNext,
  ): Promise<unknown> {
    return next(context);
  }
}

/**
 * Compose multiple middleware into a single chain.
 * First middleware in the array is outermost (runs first on request, last on response).
 */
export function composeMiddleware(...middlewares: Middleware[]): Middleware[] {
  return middlewares;
}

/**
 * Apply a middleware chain to a handler, returning the wrapped handler.
 */
export function applyMiddleware(
  middlewares: Middleware[],
  handler: CallNext,
): CallNext {
  // Build from inside out: last middleware wraps the handler first
  let current = handler;
  for (let i = middlewares.length - 1; i >= 0; i--) {
    const mw = middlewares[i];
    const next = current;
    current = async (ctx) => mw.handle(ctx, next);
  }
  return current;
}
