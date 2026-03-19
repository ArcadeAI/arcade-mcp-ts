import { describe, expect, it } from "vitest";
import {
  BinaryCritic,
  cosineSimilarity,
  NumericCritic,
  SimilarityCritic,
} from "../../src/evals/critics.js";

describe("BinaryCritic", () => {
  it("matches exact strings", () => {
    const critic = new BinaryCritic({ field: "name" });
    const result = critic.evaluate("Alice", "Alice");
    expect(result.match).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it("matches case-insensitively", () => {
    const critic = new BinaryCritic({ field: "name" });
    const result = critic.evaluate("alice", "ALICE");
    expect(result.match).toBe(true);
  });

  it("fails on different values", () => {
    const critic = new BinaryCritic({ field: "name" });
    const result = critic.evaluate("Alice", "Bob");
    expect(result.match).toBe(false);
    expect(result.score).toBe(0);
  });

  it("coerces numbers and strings", () => {
    const critic = new BinaryCritic({ field: "count" });
    const result = critic.evaluate(42, "42");
    expect(result.match).toBe(true);
  });

  it("handles null values", () => {
    const critic = new BinaryCritic({ field: "name" });
    expect(critic.evaluate(null, null).match).toBe(true);
    expect(critic.evaluate(null, "Alice").match).toBe(false);
  });

  it("uses custom weight", () => {
    const critic = new BinaryCritic({ field: "name", weight: 2.0 });
    const result = critic.evaluate("Alice", "Alice");
    expect(result.score).toBe(2.0);
    expect(result.weight).toBe(2.0);
  });
});

describe("NumericCritic", () => {
  it("scores exact match as full weight", () => {
    const critic = new NumericCritic({
      field: "count",
      valueRange: [0, 100],
    });
    const result = critic.evaluate(50, 50);
    expect(result.match).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it("scores nearby values highly", () => {
    const critic = new NumericCritic({
      field: "count",
      valueRange: [0, 100],
    });
    const result = critic.evaluate(50, 55);
    expect(result.score).toBeGreaterThan(0.9);
  });

  it("scores distant values poorly", () => {
    const critic = new NumericCritic({
      field: "count",
      valueRange: [0, 100],
    });
    const result = critic.evaluate(0, 100);
    expect(result.score).toBe(0);
    expect(result.match).toBe(false);
  });

  it("handles string-to-number coercion", () => {
    const critic = new NumericCritic({
      field: "count",
      valueRange: [0, 100],
    });
    const result = critic.evaluate(50, "50");
    expect(result.match).toBe(true);
  });

  it("fails on non-numeric values", () => {
    const critic = new NumericCritic({
      field: "count",
      valueRange: [0, 100],
    });
    const result = critic.evaluate(50, "not a number");
    expect(result.match).toBe(false);
    expect(result.score).toBe(0);
  });

  it("uses custom match threshold", () => {
    const critic = new NumericCritic({
      field: "count",
      valueRange: [0, 100],
      matchThreshold: 1.0,
    });
    // 5% difference → similarity = 0.95
    const result = critic.evaluate(50, 55);
    expect(result.match).toBe(false); // threshold is 1.0
  });

  it("throws on invalid range", () => {
    expect(
      () =>
        new NumericCritic({
          field: "count",
          valueRange: [100, 0],
        }),
    ).toThrow();
  });
});

describe("SimilarityCritic", () => {
  it("scores identical strings as 1.0", () => {
    const critic = new SimilarityCritic({ field: "text" });
    const result = critic.evaluate("hello world", "hello world");
    expect(result.score).toBeCloseTo(1.0, 10);
    expect(result.match).toBe(true);
  });

  it("scores similar strings highly", () => {
    const critic = new SimilarityCritic({ field: "text" });
    const result = critic.evaluate(
      "the quick brown fox",
      "the quick brown dog",
    );
    expect(result.score).toBeGreaterThan(0.5);
  });

  it("scores completely different strings low", () => {
    const critic = new SimilarityCritic({ field: "text" });
    const result = critic.evaluate("hello", "xyz");
    expect(result.score).toBe(0);
    expect(result.match).toBe(false);
  });

  it("handles both empty strings as a match", () => {
    const critic = new SimilarityCritic({ field: "text" });
    const result = critic.evaluate("", "");
    expect(result.match).toBe(true);
  });

  it("handles one empty string as no match", () => {
    const critic = new SimilarityCritic({ field: "text" });
    const result = critic.evaluate("hello", "");
    expect(result.match).toBe(false);
  });

  it("handles arrays by joining", () => {
    const critic = new SimilarityCritic({ field: "tags" });
    const result = critic.evaluate(["hello", "world"], ["hello", "world"]);
    expect(result.match).toBe(true);
  });

  it("uses custom similarity threshold", () => {
    const critic = new SimilarityCritic({
      field: "text",
      similarityThreshold: 0.99,
    });
    const result = critic.evaluate(
      "the quick brown fox",
      "the quick brown dog",
    );
    expect(result.match).toBe(false); // not similar enough
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(cosineSimilarity("hello world", "hello world")).toBeCloseTo(1, 10);
  });

  it("returns 0 for completely different strings", () => {
    expect(cosineSimilarity("abc", "xyz")).toBe(0);
  });

  it("returns value between 0 and 1 for partial overlap", () => {
    const sim = cosineSimilarity("hello world", "hello there");
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });
});
