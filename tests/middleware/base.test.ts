import { describe, expect, it, vi } from "vitest";
import {
	applyMiddleware,
	composeMiddleware,
	Middleware,
} from "../../src/middleware/base.js";
import type { CallNext, MiddlewareContext } from "../../src/types.js";

function makeContext(
	overrides?: Partial<MiddlewareContext>,
): MiddlewareContext {
	return {
		method: "tools/call",
		params: {},
		source: "client",
		type: "request",
		timestamp: new Date(),
		requestId: "req-1",
		metadata: {},
		...overrides,
	};
}

class TrackingMiddleware extends Middleware {
	calls: string[] = [];

	override async onMessage(
		context: MiddlewareContext,
		next: CallNext,
	): Promise<unknown> {
		this.calls.push("onMessage:before");
		const result = await next(context);
		this.calls.push("onMessage:after");
		return result;
	}

	override async onCallTool(
		context: MiddlewareContext,
		next: CallNext,
	): Promise<unknown> {
		this.calls.push("onCallTool:before");
		const result = await next(context);
		this.calls.push("onCallTool:after");
		return result;
	}
}

describe("Middleware", () => {
	it("passes through by default", async () => {
		class NoopMiddleware extends Middleware {}

		const mw = new NoopMiddleware();
		const ctx = makeContext();
		const handler = vi.fn(async () => "result");

		const result = await mw.handle(ctx, handler);
		expect(result).toBe("result");
		expect(handler).toHaveBeenCalled();
	});

	it("calls method-specific hooks for tools/call", async () => {
		const mw = new TrackingMiddleware();
		const ctx = makeContext({ method: "tools/call" });
		const handler = vi.fn(async () => "result");

		await mw.handle(ctx, handler);

		expect(mw.calls).toContain("onMessage:before");
		expect(mw.calls).toContain("onCallTool:before");
		expect(mw.calls).toContain("onCallTool:after");
		expect(mw.calls).toContain("onMessage:after");
	});

	it("does not call onCallTool for tools/list", async () => {
		const mw = new TrackingMiddleware();
		const ctx = makeContext({ method: "tools/list" });
		const handler = vi.fn(async () => "result");

		await mw.handle(ctx, handler);

		expect(mw.calls).toContain("onMessage:before");
		expect(mw.calls).not.toContain("onCallTool:before");
	});
});

describe("composeMiddleware", () => {
	it("returns the array as-is", () => {
		class A extends Middleware {}
		class B extends Middleware {}

		const a = new A();
		const b = new B();
		const result = composeMiddleware(a, b);
		expect(result).toEqual([a, b]);
	});
});

describe("applyMiddleware", () => {
	it("applies middleware in correct order (first is outermost)", async () => {
		const order: string[] = [];

		class FirstMiddleware extends Middleware {
			override async onMessage(
				context: MiddlewareContext,
				next: CallNext,
			): Promise<unknown> {
				order.push("first:before");
				const result = await next(context);
				order.push("first:after");
				return result;
			}
		}

		class SecondMiddleware extends Middleware {
			override async onMessage(
				context: MiddlewareContext,
				next: CallNext,
			): Promise<unknown> {
				order.push("second:before");
				const result = await next(context);
				order.push("second:after");
				return result;
			}
		}

		const chain = applyMiddleware(
			[new FirstMiddleware(), new SecondMiddleware()],
			async () => {
				order.push("handler");
				return "result";
			},
		);

		const result = await chain(makeContext());
		expect(result).toBe("result");
		expect(order).toEqual([
			"first:before",
			"second:before",
			"handler",
			"second:after",
			"first:after",
		]);
	});

	it("works with empty middleware list", async () => {
		const handler = vi.fn(async () => "result");
		const chain = applyMiddleware([], handler);

		const result = await chain(makeContext());
		expect(result).toBe("result");
		expect(handler).toHaveBeenCalled();
	});
});
