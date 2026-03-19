/**
 * Typed response structuring for tool composition.
 *
 * Provides a tiered strategy to map arbitrary tool output into a Zod schema:
 *   Tier 1 - Direct Zod validation (zero cost)
 *   Tier 2 - Heuristic field mapping (deterministic, no LLM)
 *
 * When both tiers fail, callers (e.g. Tools.execute) can fall back to LLM extraction.
 */

import { z } from "zod";
import { ToolResponseExtractionError } from "./errors.js";

/**
 * Controls behavior when a field can't be mapped from tool response to target model.
 */
export enum OnMissing {
	FAIL = "fail",
	ALLOW_NULL = "allow_null",
}

/**
 * Options for context.tools.execute().
 */
export interface ExecuteOptions {
	/** What to do when a field can't be mapped (default: FAIL). */
	onMissing?: OnMissing;
	/** Total timeout in seconds across all retries (default: 60). */
	timeoutSeconds?: number;
	/** Max retry attempts for transient failures (default: 3). */
	maxRetries?: number;
	/** Delay between retries in seconds (default: 1.0). */
	retryDelaySeconds?: number;
}

export const EXECUTE_DEFAULTS: Required<ExecuteOptions> = {
	onMissing: OnMissing.FAIL,
	timeoutSeconds: 60,
	maxRetries: 3,
	retryDelaySeconds: 1.0,
};

/**
 * Attempt to structure raw tool output into the target Zod schema.
 *
 * Tries direct validation (Tier 1) then heuristic mapping (Tier 2).
 * Throws ToolResponseExtractionError if both tiers fail.
 */
export function structureOutput<T extends z.ZodObject<z.ZodRawShape>>(
	schema: T,
	rawData: unknown,
	onMissing: OnMissing = OnMissing.FAIL,
): z.infer<T> {
	const effectiveSchema =
		onMissing === OnMissing.ALLOW_NULL ? makeNullable(schema) : schema;

	// Tier 1: Direct validation
	const direct = tryDirect(effectiveSchema, rawData);
	if (direct !== undefined) return direct;

	// Tier 2: Heuristic mapping
	const heuristic = tryHeuristic(effectiveSchema, rawData);
	if (heuristic !== undefined) return heuristic;

	throw new ToolResponseExtractionError(
		`Could not structure tool response into target type. Data: ${truncate(rawData)}`,
		{
			developerMessage: `Both direct validation and heuristic mapping failed. Raw data type: ${typeof rawData}.`,
		},
	);
}

/**
 * Tier 1: Attempt direct Zod validation.
 */
function tryDirect<T extends z.ZodType>(
	schema: T,
	data: unknown,
): z.infer<T> | undefined {
	if (typeof data !== "object" || data === null) return undefined;
	const result = schema.safeParse(data);
	if (result.success) return result.data;
	return undefined;
}

/**
 * Tier 2: Attempt heuristic field mapping strategies.
 */
function tryHeuristic<T extends z.ZodType>(
	schema: T,
	data: unknown,
): z.infer<T> | undefined {
	if (typeof data !== "object" || data === null) return undefined;
	const obj = data as Record<string, unknown>;

	const candidates: Record<string, unknown>[] = [];

	// Strategy 1: Unwrap {"result": ...} wrapper
	if (
		Object.keys(obj).length === 1 &&
		"result" in obj &&
		typeof obj.result === "object" &&
		obj.result !== null
	) {
		candidates.push(obj.result as Record<string, unknown>);
	}

	// Strategy 2: Snake_case to camelCase key normalization
	const camelized = normalizeKeys(obj, toCamelCase);
	if (!shallowEqual(camelized, obj)) {
		candidates.push(camelized);
	}

	// Strategy 3: CamelCase to snake_case key normalization
	const snaked = normalizeKeys(obj, toSnakeCase);
	if (!shallowEqual(snaked, obj)) {
		candidates.push(snaked);
	}

	// Strategy 4: Flatten single-key nested dict
	if (Object.keys(obj).length === 1) {
		const soleValue = Object.values(obj)[0];
		if (typeof soleValue === "object" && soleValue !== null) {
			candidates.push(soleValue as Record<string, unknown>);
		}
	}

	// Strategy 5: Unwrap {"result": ...} then normalize keys
	if (
		Object.keys(obj).length === 1 &&
		"result" in obj &&
		typeof obj.result === "object" &&
		obj.result !== null
	) {
		const inner = obj.result as Record<string, unknown>;
		const innerCamelized = normalizeKeys(inner, toCamelCase);
		if (!shallowEqual(innerCamelized, inner)) {
			candidates.push(innerCamelized);
		}
	}

	for (const candidate of candidates) {
		const result = schema.safeParse(candidate);
		if (result.success) return result.data;
	}

	return undefined;
}

/**
 * Create a variant of the schema where all required fields become nullable with null default.
 * Results are cached by schema identity.
 */
const _nullableCache = new WeakMap<z.ZodType, z.ZodType>();

export function makeNullable<T extends z.ZodObject<z.ZodRawShape>>(
	schema: T,
): z.ZodObject<z.ZodRawShape> {
	const cached = _nullableCache.get(schema);
	if (cached) return cached as z.ZodObject<z.ZodRawShape>;

	const shape = schema.shape;
	const newShape: z.ZodRawShape = {};

	for (const [key, fieldSchema] of Object.entries(shape)) {
		if (isOptional(fieldSchema as z.ZodType)) {
			newShape[key] = fieldSchema as z.ZodType;
		} else {
			newShape[key] = (fieldSchema as z.ZodType).nullable().default(null);
		}
	}

	const nullableSchema = z.object(newShape);
	_nullableCache.set(schema, nullableSchema);
	return nullableSchema;
}

/**
 * Convert camelCase or PascalCase to snake_case.
 */
export function toSnakeCase(name: string): string {
	// Insert underscore before uppercase letters that follow lowercase letters or digits
	let s = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
	// Insert underscore between consecutive uppercase letters followed by lowercase
	s = s.replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2");
	return s.toLowerCase();
}

/**
 * Convert snake_case to camelCase.
 */
export function toCamelCase(name: string): string {
	return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function normalizeKeys(
	obj: Record<string, unknown>,
	transform: (key: string) => string,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		result[transform(key)] = value;
	}
	return result;
}

function shallowEqual(
	a: Record<string, unknown>,
	b: Record<string, unknown>,
): boolean {
	const keysA = Object.keys(a);
	const keysB = Object.keys(b);
	if (keysA.length !== keysB.length) return false;
	for (const key of keysA) {
		if (a[key] !== b[key]) return false;
	}
	return true;
}

function isOptional(schema: z.ZodType): boolean {
	const def = (schema as unknown as { _def: Record<string, unknown> })._def;
	return (
		def.typeName === "ZodOptional" ||
		def.typeName === "ZodDefault" ||
		(def.typeName === "ZodNullable" && isOptional(def.innerType as z.ZodType))
	);
}

function truncate(data: unknown, maxLen = 200): string {
	const s = JSON.stringify(data);
	if (s && s.length > maxLen) {
		return `${s.slice(0, maxLen)}...`;
	}
	return s ?? "undefined";
}
