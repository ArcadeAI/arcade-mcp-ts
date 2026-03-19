import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolResponseExtractionError } from "../src/errors.js";
import {
	EXECUTE_DEFAULTS,
	makeNullable,
	OnMissing,
	structureOutput,
	toCamelCase,
	toSnakeCase,
} from "../src/structuring.js";

// ── Test schemas ────────────────────────────────────────────

const SimpleSchema = z.object({
	name: z.string(),
	value: z.number(),
});

const NestedSchema = z.object({
	inner: z.object({
		name: z.string(),
		count: z.number(),
	}),
	tag: z.string(),
});

const WithOptionalSchema = z.object({
	required: z.string(),
	optional: z.string().optional(),
	withDefault: z.number().default(42),
});

// ── EXECUTE_DEFAULTS ────────────────────────────────────────

describe("EXECUTE_DEFAULTS", () => {
	it("has expected default values", () => {
		expect(EXECUTE_DEFAULTS.onMissing).toBe(OnMissing.FAIL);
		expect(EXECUTE_DEFAULTS.timeoutSeconds).toBe(60);
		expect(EXECUTE_DEFAULTS.maxRetries).toBe(3);
		expect(EXECUTE_DEFAULTS.retryDelaySeconds).toBe(1.0);
	});
});

// ── Tier 1: Direct validation ───────────────────────────────

describe("structureOutput — Tier 1 (direct)", () => {
	it("parses exact match", () => {
		const result = structureOutput(SimpleSchema, { name: "test", value: 42 });
		expect(result).toEqual({ name: "test", value: 42 });
	});

	it("parses with extra fields (Zod strips by default)", () => {
		const result = structureOutput(SimpleSchema, {
			name: "test",
			value: 42,
			extra: "ignored",
		});
		expect(result).toEqual({ name: "test", value: 42 });
	});

	it("parses nested objects", () => {
		const data = {
			inner: { name: "inner", count: 5 },
			tag: "hello",
		};
		const result = structureOutput(NestedSchema, data);
		expect(result).toEqual(data);
	});

	it("handles optional and default fields", () => {
		const result = structureOutput(WithOptionalSchema, { required: "yes" });
		expect(result.required).toBe("yes");
		expect(result.optional).toBeUndefined();
		expect(result.withDefault).toBe(42);
	});

	it("rejects non-object data at tier 1", () => {
		expect(() => structureOutput(SimpleSchema, "not an object")).toThrow(
			ToolResponseExtractionError,
		);
	});

	it("rejects null data", () => {
		expect(() => structureOutput(SimpleSchema, null)).toThrow(
			ToolResponseExtractionError,
		);
	});
});

// ── Tier 2: Heuristic mapping ───────────────────────────────

describe("structureOutput — Tier 2 (heuristics)", () => {
	it("unwraps {result: ...} wrapper", () => {
		const data = { result: { name: "test", value: 42 } };
		const result = structureOutput(SimpleSchema, data);
		expect(result).toEqual({ name: "test", value: 42 });
	});

	it("normalizes camelCase keys to snake_case", () => {
		const schema = z.object({
			user_name: z.string(),
			email_address: z.string(),
		});
		const data = { userName: "alice", emailAddress: "alice@example.com" };
		const result = structureOutput(schema, data);
		expect(result).toEqual({
			user_name: "alice",
			email_address: "alice@example.com",
		});
	});

	it("normalizes snake_case keys to camelCase", () => {
		const schema = z.object({
			userName: z.string(),
			emailAddress: z.string(),
		});
		const data = { user_name: "alice", email_address: "alice@example.com" };
		const result = structureOutput(schema, data);
		expect(result).toEqual({
			userName: "alice",
			emailAddress: "alice@example.com",
		});
	});

	it("flattens single-key nested dict", () => {
		const data = { data: { name: "test", value: 42 } };
		const result = structureOutput(SimpleSchema, data);
		expect(result).toEqual({ name: "test", value: 42 });
	});

	it("unwraps result then normalizes keys", () => {
		const schema = z.object({
			userName: z.string(),
			userAge: z.number(),
		});
		const data = { result: { user_name: "alice", user_age: 30 } };
		const result = structureOutput(schema, data);
		expect(result).toEqual({ userName: "alice", userAge: 30 });
	});

	it("throws when no heuristic matches", () => {
		const data = { completely: "wrong", shape: true };
		expect(() => structureOutput(SimpleSchema, data)).toThrow(
			ToolResponseExtractionError,
		);
	});
});

// ── OnMissing.ALLOW_NULL ────────────────────────────────────

describe("structureOutput — ALLOW_NULL", () => {
	it("allows missing required fields as null", () => {
		const result = structureOutput(SimpleSchema, {}, OnMissing.ALLOW_NULL);
		expect(result.name).toBeNull();
		expect(result.value).toBeNull();
	});

	it("preserves present fields", () => {
		const result = structureOutput(
			SimpleSchema,
			{ name: "test" },
			OnMissing.ALLOW_NULL,
		);
		expect(result.name).toBe("test");
		expect(result.value).toBeNull();
	});

	it("FAIL mode throws on missing required fields", () => {
		expect(() =>
			structureOutput(SimpleSchema, { name: "test" }, OnMissing.FAIL),
		).toThrow(ToolResponseExtractionError);
	});
});

// ── makeNullable ────────────────────────────────────────────

describe("makeNullable", () => {
	it("makes required fields nullable with null default", () => {
		const nullable = makeNullable(SimpleSchema);
		const result = nullable.parse({});
		expect(result.name).toBeNull();
		expect(result.value).toBeNull();
	});

	it("keeps optional fields as-is", () => {
		const nullable = makeNullable(WithOptionalSchema);
		const result = nullable.parse({});
		expect(result.required).toBeNull();
		expect(result.withDefault).toBe(42);
	});

	it("caches nullable schemas", () => {
		const nullable1 = makeNullable(SimpleSchema);
		const nullable2 = makeNullable(SimpleSchema);
		expect(nullable1).toBe(nullable2);
	});
});

// ── Helpers ─────────────────────────────────────────────────

describe("toSnakeCase", () => {
	it("converts camelCase", () => {
		expect(toSnakeCase("camelCase")).toBe("camel_case");
	});

	it("converts PascalCase", () => {
		expect(toSnakeCase("PascalCase")).toBe("pascal_case");
	});

	it("handles consecutive uppercase (e.g. HTMLParser)", () => {
		expect(toSnakeCase("HTMLParser")).toBe("html_parser");
	});

	it("leaves snake_case unchanged", () => {
		expect(toSnakeCase("already_snake")).toBe("already_snake");
	});
});

describe("toCamelCase", () => {
	it("converts snake_case", () => {
		expect(toCamelCase("snake_case")).toBe("snakeCase");
	});

	it("handles multiple underscores", () => {
		expect(toCamelCase("a_long_name")).toBe("aLongName");
	});

	it("leaves camelCase unchanged", () => {
		expect(toCamelCase("alreadyCamel")).toBe("alreadyCamel");
	});
});
