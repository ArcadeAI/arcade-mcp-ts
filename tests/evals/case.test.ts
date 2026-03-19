import { describe, expect, it } from "vitest";
import { EvalCase } from "../../src/evals/case.js";
import { BinaryCritic, NumericCritic } from "../../src/evals/critics.js";

describe("EvalCase", () => {
  describe("evaluate", () => {
    it("passes when tool name and args match", () => {
      const evalCase = new EvalCase({
        name: "test",
        userMessage: "test",
        expectedToolCalls: [{ toolName: "echo", args: { message: "hello" } }],
        critics: [new BinaryCritic({ field: "message" })],
      });

      const result = evalCase.evaluate([
        { name: "echo", args: { message: "hello" } },
      ]);

      expect(result.passed).toBe(true);
      expect(result.score).toBe(1.0);
    });

    it("fails when tool name doesn't match", () => {
      const evalCase = new EvalCase({
        name: "test",
        userMessage: "test",
        expectedToolCalls: [{ toolName: "echo", args: { message: "hello" } }],
        critics: [new BinaryCritic({ field: "message" })],
      });

      const result = evalCase.evaluate([
        { name: "reverse", args: { message: "hello" } },
      ]);

      expect(result.passed).toBe(false);
      expect(result.failureReason).toContain("Expected tool");
    });

    it("matches tool names with normalization", () => {
      const evalCase = new EvalCase({
        name: "test",
        userMessage: "test",
        expectedToolCalls: [{ toolName: "My.Tool-Name", args: { x: 1 } }],
        critics: [new BinaryCritic({ field: "x" })],
      });

      const result = evalCase.evaluate([
        { name: "My_Tool_Name", args: { x: 1 } },
      ]);

      expect(result.passed).toBe(true);
    });

    it("fails on wrong number of tool calls", () => {
      const evalCase = new EvalCase({
        name: "test",
        userMessage: "test",
        expectedToolCalls: [{ toolName: "echo", args: { message: "hello" } }],
        critics: [new BinaryCritic({ field: "message" })],
      });

      const result = evalCase.evaluate([
        { name: "echo", args: { message: "hello" } },
        { name: "echo", args: { message: "world" } },
      ]);

      expect(result.passed).toBe(false);
      expect(result.failureReason).toContain("Expected 1");
    });

    it("passes with no expected and no actual calls", () => {
      const evalCase = new EvalCase({
        name: "test",
        userMessage: "test",
        expectedToolCalls: [],
      });

      const result = evalCase.evaluate([]);
      expect(result.passed).toBe(true);
      expect(result.score).toBe(1.0);
    });

    it("fails when expected calls but got none", () => {
      const evalCase = new EvalCase({
        name: "test",
        userMessage: "test",
        expectedToolCalls: [{ toolName: "echo", args: { message: "hello" } }],
      });

      const result = evalCase.evaluate([]);
      expect(result.passed).toBe(false);
    });

    it("handles multiple critics with different weights", () => {
      const evalCase = new EvalCase({
        name: "test",
        userMessage: "test",
        expectedToolCalls: [
          {
            toolName: "search",
            args: { query: "test", count: 10 },
          },
        ],
        critics: [
          new BinaryCritic({ field: "query", weight: 2.0 }),
          new NumericCritic({
            field: "count",
            weight: 1.0,
            valueRange: [1, 50],
          }),
        ],
      });

      const result = evalCase.evaluate([
        { name: "search", args: { query: "test", count: 10 } },
      ]);

      expect(result.passed).toBe(true);
      expect(result.score).toBe(1.0);
    });

    it("computes partial score with mismatched args", () => {
      const evalCase = new EvalCase({
        name: "test",
        userMessage: "test",
        expectedToolCalls: [
          {
            toolName: "search",
            args: { query: "test", count: 10 },
          },
        ],
        critics: [
          new BinaryCritic({ field: "query", weight: 1.0 }),
          new BinaryCritic({ field: "count", weight: 1.0 }),
        ],
      });

      // Right tool, right query, wrong count
      const result = evalCase.evaluate([
        { name: "search", args: { query: "test", count: 99 } },
      ]);

      // tool name (1.0) + query match (1.0) + count mismatch (0) = 2/3
      expect(result.score).toBeCloseTo(2 / 3, 2);
    });

    it("respects case-level rubric override", () => {
      const evalCase = new EvalCase({
        name: "test",
        userMessage: "test",
        expectedToolCalls: [{ toolName: "echo", args: { message: "hello" } }],
        critics: [new BinaryCritic({ field: "message" })],
        rubric: { failThreshold: 0.99 },
      });

      // Partial match: tool name matches, arg doesn't
      const result = evalCase.evaluate([
        { name: "echo", args: { message: "world" } },
      ]);

      // Score = 1/2 (tool name match only), threshold is 0.99
      expect(result.passed).toBe(false);
    });

    it("can disable tool selection failure", () => {
      const evalCase = new EvalCase({
        name: "test",
        userMessage: "test",
        expectedToolCalls: [{ toolName: "echo", args: { message: "hello" } }],
        critics: [new BinaryCritic({ field: "message" })],
        rubric: {
          failOnToolSelection: false,
          failThreshold: 0.3,
        },
      });

      const result = evalCase.evaluate([
        { name: "wrong_tool", args: { message: "hello" } },
      ]);

      // Won't immediately fail on name mismatch, scores arg match
      expect(result.score).toBeGreaterThan(0);
    });

    it("can disable tool call quantity failure", () => {
      const evalCase = new EvalCase({
        name: "test",
        userMessage: "test",
        expectedToolCalls: [{ toolName: "echo", args: { message: "hello" } }],
        critics: [new BinaryCritic({ field: "message" })],
        rubric: {
          failOnToolCallQuantity: false,
          failThreshold: 0.3,
        },
      });

      const result = evalCase.evaluate([
        { name: "echo", args: { message: "hello" } },
        { name: "echo", args: { message: "extra" } },
      ]);

      // Won't immediately fail on quantity mismatch
      expect(result.score).toBeGreaterThan(0);
    });
  });
});
