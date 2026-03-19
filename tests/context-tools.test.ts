import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
	Context,
	type ServerExtra,
	type ToolExecutor,
} from "../src/context.js";
import {
	RetryableToolError,
	ToolResponseExtractionError,
} from "../src/errors.js";
import { loadSettings } from "../src/settings.js";
import { OnMissing } from "../src/structuring.js";

// ── Test schemas ────────────────────────────────────────────

const SimpleSchema = z.object({
	name: z.string(),
	value: z.number(),
});

// ── Helpers ─────────────────────────────────────────────────

function makeExtra(overrides?: Partial<ServerExtra>): ServerExtra {
	return {
		signal: new AbortController().signal,
		requestId: "req-1",
		sessionId: "sess-1",
		sendNotification: vi.fn(async () => {}),
		sendRequest: vi.fn(async () => ({})),
		...overrides,
	} as never;
}

function makeToolExecutor(overrides?: Partial<ToolExecutor>): ToolExecutor {
	return {
		executeToolByName: vi.fn(async () => ({
			content: [{ type: "text" as const, text: '{"name":"test","value":42}' }],
			structuredContent: { name: "test", value: 42 },
			isError: false,
		})),
		getArcadeClient: vi.fn(() => undefined),
		getSettings: vi.fn(() => loadSettings()),
		hasToolInCatalog: vi.fn(() => true),
		...overrides,
	};
}

// ── Tools.call() ────────────────────────────────────────────

describe("Tools.call()", () => {
	it("returns error when no toolExecutor", async () => {
		const ctx = new Context(makeExtra());
		const result = await ctx.tools.call("test_tool");
		expect(result?.isError).toBe(true);
		expect(result?.content[0]).toHaveProperty(
			"text",
			expect.stringContaining("not available"),
		);
	});

	it("delegates to executeToolByName for local tools", async () => {
		const executor = makeToolExecutor();
		const ctx = new Context(makeExtra(), { toolExecutor: executor });
		const result = await ctx.tools.call("test_tool", { arg: 1 });
		expect(executor.executeToolByName).toHaveBeenCalledOnce();
		expect(result?.isError).toBe(false);
	});

	it("returns error when tool not found locally and no arcade", async () => {
		const executor = makeToolExecutor({
			hasToolInCatalog: vi.fn(() => false),
			getArcadeClient: vi.fn(() => undefined),
		});
		const ctx = new Context(makeExtra(), { toolExecutor: executor });
		const result = await ctx.tools.call("unknown_tool");
		expect(result?.isError).toBe(true);
		expect(result?.content[0]).toHaveProperty(
			"text",
			expect.stringContaining("not found"),
		);
	});
});

// ── Tools.callRaw() ─────────────────────────────────────────

describe("Tools.callRaw()", () => {
	it("calls local tool when present in catalog", async () => {
		const executor = makeToolExecutor();
		const ctx = new Context(makeExtra(), { toolExecutor: executor });
		const result = await ctx.tools.callRaw("test_tool", {});
		expect(result.isError).toBe(false);
		expect(result.structuredContent).toEqual({ name: "test", value: 42 });
	});

	it("falls back to remote when not in catalog and arcade available", async () => {
		const mockArcade = {
			tools: {
				execute: vi.fn(async () => ({
					success: true,
					output: { value: { key: "remote_value" }, error: null },
				})),
			},
		};

		const executor = makeToolExecutor({
			hasToolInCatalog: vi.fn(() => false),
			getArcadeClient: vi.fn(() => mockArcade),
		});

		const ctx = new Context(makeExtra(), {
			toolExecutor: executor,
			resourceOwner: { userId: "user@test.com", claims: {} },
		});
		const result = await ctx.tools.callRaw("Remote.Tool", {});
		expect(result.isError).toBe(false);
		expect(result.structuredContent).toEqual({ key: "remote_value" });
	});

	it("handles remote tool failure", async () => {
		const mockArcade = {
			tools: {
				execute: vi.fn(async () => ({
					success: false,
					output: { value: null, error: "Permission denied" },
				})),
			},
		};

		const executor = makeToolExecutor({
			hasToolInCatalog: vi.fn(() => false),
			getArcadeClient: vi.fn(() => mockArcade),
		});

		const ctx = new Context(makeExtra(), { toolExecutor: executor });
		const result = await ctx.tools.callRaw("Remote.Tool", {});
		expect(result.isError).toBe(true);
		expect(result.content[0]).toHaveProperty(
			"text",
			expect.stringContaining("Permission denied"),
		);
	});

	it("handles remote tool exception", async () => {
		const mockArcade = {
			tools: {
				execute: vi.fn(async () => {
					throw new Error("Network error");
				}),
			},
		};

		const executor = makeToolExecutor({
			hasToolInCatalog: vi.fn(() => false),
			getArcadeClient: vi.fn(() => mockArcade),
		});

		const ctx = new Context(makeExtra(), { toolExecutor: executor });
		const result = await ctx.tools.callRaw("Remote.Tool", {});
		expect(result.isError).toBe(true);
		expect(result.content[0]).toHaveProperty(
			"text",
			expect.stringContaining("Network error"),
		);
	});
});

// ── Tools.execute() ─────────────────────────────────────────

describe("Tools.execute()", () => {
	it("structures direct response (Tier 1)", async () => {
		const executor = makeToolExecutor();
		const ctx = new Context(makeExtra(), { toolExecutor: executor });

		const result = await ctx.tools.execute(SimpleSchema, "test_tool", {});
		expect(result).toEqual({ name: "test", value: 42 });
	});

	it("structures heuristic response (Tier 2 — unwrap result)", async () => {
		const executor = makeToolExecutor({
			executeToolByName: vi.fn(async () => ({
				content: [
					{
						type: "text" as const,
						text: '{"result":{"name":"wrapped","value":99}}',
					},
				],
				structuredContent: { result: { name: "wrapped", value: 99 } },
				isError: false,
			})),
		});

		const ctx = new Context(makeExtra(), { toolExecutor: executor });
		const result = await ctx.tools.execute(SimpleSchema, "test_tool", {});
		expect(result).toEqual({ name: "wrapped", value: 99 });
	});

	it("raises ToolResponseExtractionError on tool error", async () => {
		const executor = makeToolExecutor({
			executeToolByName: vi.fn(async () => ({
				content: [{ type: "text" as const, text: "bad input" }],
				structuredContent: { error: "bad input" },
				isError: true,
			})),
		});

		const ctx = new Context(makeExtra(), { toolExecutor: executor });
		await expect(
			ctx.tools.execute(SimpleSchema, "test_tool", {}),
		).rejects.toThrow(ToolResponseExtractionError);
	});

	it("returns empty model on ALLOW_NULL when all tiers fail", async () => {
		const executor = makeToolExecutor({
			executeToolByName: vi.fn(async () => ({
				content: [{ type: "text" as const, text: "raw text no json" }],
				isError: false,
			})),
		});

		const ctx = new Context(makeExtra(), { toolExecutor: executor });
		const result = await ctx.tools.execute(
			SimpleSchema,
			"test_tool",
			{},
			{ onMissing: OnMissing.ALLOW_NULL, maxRetries: 0 },
		);
		expect(result.name).toBeNull();
		expect(result.value).toBeNull();
	});

	it("retries on RetryableToolError", async () => {
		let callCount = 0;
		const executor = makeToolExecutor({
			executeToolByName: vi.fn(async () => {
				callCount++;
				if (callCount < 3) {
					throw new RetryableToolError("transient");
				}
				return {
					content: [
						{ type: "text" as const, text: '{"name":"done","value":1}' },
					],
					structuredContent: { name: "done", value: 1 },
					isError: false,
				};
			}),
		});

		const ctx = new Context(makeExtra(), { toolExecutor: executor });
		const result = await ctx.tools.execute(
			SimpleSchema,
			"test_tool",
			{},
			{ maxRetries: 3, retryDelaySeconds: 0.01 },
		);
		expect(result).toEqual({ name: "done", value: 1 });
		expect(callCount).toBe(3);
	});

	it("does not retry ToolResponseExtractionError", async () => {
		const executor = makeToolExecutor({
			executeToolByName: vi.fn(async () => ({
				content: [{ type: "text" as const, text: "error" }],
				structuredContent: { error: "bad" },
				isError: true,
			})),
		});

		const ctx = new Context(makeExtra(), { toolExecutor: executor });
		await expect(
			ctx.tools.execute(SimpleSchema, "test_tool", {}, { maxRetries: 3 }),
		).rejects.toThrow(ToolResponseExtractionError);
		// Should only be called once (no retries)
		expect(executor.executeToolByName).toHaveBeenCalledOnce();
	});
});
