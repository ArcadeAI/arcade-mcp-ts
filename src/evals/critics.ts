import type { CriticResult } from "./types.js";

/**
 * Abstract base class for evaluation critics.
 * A critic evaluates a single field of a tool call's arguments.
 */
export abstract class Critic {
	/** The argument field this critic evaluates */
	readonly field: string;
	/** Weight of this critic in the overall score */
	readonly weight: number;

	constructor(options: { field: string; weight: number }) {
		if (options.weight < 0) {
			throw new Error(
				`Critic weight must be non-negative, got ${options.weight}`,
			);
		}
		this.field = options.field;
		this.weight = options.weight;
	}

	/**
	 * Evaluate expected vs actual values for this critic's field.
	 */
	abstract evaluate(expected: unknown, actual: unknown): CriticResult;
}

/**
 * Exact equality critic. Returns full weight if values match, 0 otherwise.
 * Performs type coercion for numbers and strings.
 */
export class BinaryCritic extends Critic {
	constructor(options: { field: string; weight?: number }) {
		super({ field: options.field, weight: options.weight ?? 1.0 });
	}

	evaluate(expected: unknown, actual: unknown): CriticResult {
		const match = coercedEquals(expected, actual);
		return {
			field: this.field,
			match,
			score: match ? this.weight : 0,
			weight: this.weight,
			expected,
			actual,
		};
	}
}

/**
 * Fuzzy numeric comparison critic. Scores based on how close
 * the actual value is to the expected value within a given range.
 */
export class NumericCritic extends Critic {
	/** Range [min, max] for normalization */
	readonly valueRange: [number, number];
	/** Score threshold for considering it a match. Default 0.8 */
	readonly matchThreshold: number;

	constructor(options: {
		field: string;
		weight?: number;
		valueRange: [number, number];
		matchThreshold?: number;
	}) {
		super({ field: options.field, weight: options.weight ?? 1.0 });
		this.valueRange = options.valueRange;
		this.matchThreshold = options.matchThreshold ?? 0.8;

		if (this.valueRange[0] >= this.valueRange[1]) {
			throw new Error(
				`valueRange min (${this.valueRange[0]}) must be less than max (${this.valueRange[1]})`,
			);
		}
	}

	evaluate(expected: unknown, actual: unknown): CriticResult {
		const expectedNum = toNumber(expected);
		const actualNum = toNumber(actual);

		if (expectedNum === null || actualNum === null) {
			return {
				field: this.field,
				match: false,
				score: 0,
				weight: this.weight,
				expected,
				actual,
			};
		}

		const range = this.valueRange[1] - this.valueRange[0];
		const normalizedExpected = (expectedNum - this.valueRange[0]) / range;
		const normalizedActual = (actualNum - this.valueRange[0]) / range;
		const similarity = 1 - Math.abs(normalizedExpected - normalizedActual);
		const clampedSimilarity = Math.max(0, Math.min(1, similarity));
		const score = clampedSimilarity * this.weight;
		const match = clampedSimilarity >= this.matchThreshold;

		return {
			field: this.field,
			match,
			score,
			weight: this.weight,
			expected,
			actual,
		};
	}
}

/**
 * String similarity critic using word-frequency cosine similarity.
 * A lightweight pure-TS alternative to sklearn's TF-IDF cosine similarity.
 */
export class SimilarityCritic extends Critic {
	/** Minimum similarity for considering it a match. Default 0.75 */
	readonly similarityThreshold: number;

	constructor(options: {
		field: string;
		weight?: number;
		similarityThreshold?: number;
	}) {
		super({ field: options.field, weight: options.weight ?? 1.0 });
		this.similarityThreshold = options.similarityThreshold ?? 0.75;
	}

	evaluate(expected: unknown, actual: unknown): CriticResult {
		const expectedStr = toStr(expected);
		const actualStr = toStr(actual);

		if (!expectedStr && !actualStr) {
			return {
				field: this.field,
				match: true,
				score: this.weight,
				weight: this.weight,
				expected,
				actual,
			};
		}

		if (!expectedStr || !actualStr) {
			return {
				field: this.field,
				match: false,
				score: 0,
				weight: this.weight,
				expected,
				actual,
			};
		}

		const similarity = cosineSimilarity(expectedStr, actualStr);
		const score = Math.min(similarity * this.weight, this.weight);
		const match = similarity >= this.similarityThreshold;

		return {
			field: this.field,
			match,
			score,
			weight: this.weight,
			expected,
			actual,
		};
	}
}

// ── Helpers ──────────────────────────────────────────────

function coercedEquals(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a === null || a === undefined || b === null || b === undefined) {
		// Treat null and undefined as equivalent
		return (a === null || a === undefined) && (b === null || b === undefined);
	}

	// Try numeric comparison
	const aNum = toNumber(a);
	const bNum = toNumber(b);
	if (aNum !== null && bNum !== null) return aNum === bNum;

	// String comparison (case-insensitive for strings)
	const aStr = String(a).trim().toLowerCase();
	const bStr = String(b).trim().toLowerCase();
	return aStr === bStr;
}

function toNumber(value: unknown): number | null {
	if (typeof value === "number") return value;
	if (typeof value === "string") {
		const n = Number(value);
		return Number.isNaN(n) ? null : n;
	}
	return null;
}

function toStr(value: unknown): string {
	if (value == null) return "";
	if (Array.isArray(value)) return value.join(" ");
	return String(value);
}

/**
 * Compute cosine similarity between two strings using word frequencies.
 */
export function cosineSimilarity(a: string, b: string): number {
	const freqA = wordFrequencies(a);
	const freqB = wordFrequencies(b);

	// Get all unique words
	const allWords = new Set([...freqA.keys(), ...freqB.keys()]);

	let dotProduct = 0;
	let normA = 0;
	let normB = 0;

	for (const word of allWords) {
		const fa = freqA.get(word) ?? 0;
		const fb = freqB.get(word) ?? 0;
		dotProduct += fa * fb;
		normA += fa * fa;
		normB += fb * fb;
	}

	if (normA === 0 || normB === 0) return 0;
	return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function wordFrequencies(text: string): Map<string, number> {
	const freq = new Map<string, number>();
	const words = text
		.toLowerCase()
		.replace(/[^\w\s]/g, " ")
		.split(/\s+/)
		.filter(Boolean);
	for (const word of words) {
		freq.set(word, (freq.get(word) ?? 0) + 1);
	}
	return freq;
}
