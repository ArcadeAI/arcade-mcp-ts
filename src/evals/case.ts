import type { Critic } from "./critics.js";
import { hungarian } from "./hungarian.js";
import {
  type ActualToolCall,
  type CriticResult,
  compareToolNames,
  type EvalMessage,
  type EvalRubric,
  type EvaluationResult,
  type ExpectedToolCall,
  type ResolvedEvalRubric,
  resolveRubric,
} from "./types.js";

/**
 * A single evaluation case — one user prompt with expected tool calls.
 */
export class EvalCase {
  readonly name: string;
  readonly userMessage: string;
  readonly systemMessage?: string;
  readonly expectedToolCalls: ExpectedToolCall[];
  readonly critics: Critic[];
  readonly rubric?: EvalRubric;
  readonly additionalMessages: EvalMessage[];

  constructor(options: {
    name: string;
    userMessage: string;
    expectedToolCalls: ExpectedToolCall[];
    critics?: Critic[];
    systemMessage?: string;
    rubric?: EvalRubric;
    additionalMessages?: EvalMessage[];
  }) {
    this.name = options.name;
    this.userMessage = options.userMessage;
    this.expectedToolCalls = options.expectedToolCalls;
    this.critics = options.critics ?? [];
    this.systemMessage = options.systemMessage;
    this.rubric = options.rubric;
    this.additionalMessages = options.additionalMessages ?? [];
  }

  /**
   * Evaluate actual tool calls against expected tool calls.
   */
  evaluate(
    actualToolCalls: ActualToolCall[],
    suiteRubric?: EvalRubric,
  ): EvaluationResult {
    const rubric = resolveRubric(this.rubric ?? suiteRubric);
    const expected = this.expectedToolCalls;
    const actual = actualToolCalls;

    // No expected tool calls — pass if no actual calls
    if (expected.length === 0) {
      const passed = actual.length === 0;
      return {
        score: passed ? 1.0 : 0.0,
        passed,
        warning: false,
        results: [],
        failureReason: passed
          ? undefined
          : `Expected no tool calls but got ${actual.length}`,
      };
    }

    // No actual tool calls but expected some
    if (actual.length === 0) {
      return {
        score: 0,
        passed: false,
        warning: false,
        results: [],
        failureReason: `Expected ${expected.length} tool call(s) but got none`,
      };
    }

    // Check tool call quantity
    if (rubric.failOnToolCallQuantity && expected.length !== actual.length) {
      return {
        score: 0,
        passed: false,
        warning: false,
        results: [],
        failureReason: `Expected ${expected.length} tool call(s) but got ${actual.length}`,
      };
    }

    // Build cost matrix and find optimal assignment
    const { assignment, allResults, totalScore, totalWeight } =
      this.matchAndScore(expected, actual, rubric);

    // Check tool selection for matched pairs
    if (rubric.failOnToolSelection) {
      for (const [ei, ai] of assignment) {
        if (!compareToolNames(expected[ei].toolName, actual[ai].name)) {
          return {
            score: 0,
            passed: false,
            warning: false,
            results: allResults,
            failureReason: `Expected tool "${expected[ei].toolName}" but got "${actual[ai].name}"`,
          };
        }
      }
    }

    const score = totalWeight > 0 ? totalScore / totalWeight : 1.0;
    const passed = score >= rubric.failThreshold;
    const warning = passed && score < rubric.warnThreshold;

    return {
      score,
      passed,
      warning,
      results: allResults,
      failureReason: passed
        ? undefined
        : `Score ${score.toFixed(3)} below threshold ${rubric.failThreshold}`,
    };
  }

  private matchAndScore(
    expected: ExpectedToolCall[],
    actual: ActualToolCall[],
    rubric: ResolvedEvalRubric,
  ): {
    assignment: [number, number][];
    allResults: CriticResult[];
    totalScore: number;
    totalWeight: number;
  } {
    const n = expected.length;
    const m = actual.length;

    // If single expected and single actual, skip Hungarian
    if (n === 1 && m === 1) {
      const { results, score, weight } = this.scorePair(
        expected[0],
        actual[0],
        rubric,
      );
      return {
        assignment: [[0, 0]],
        allResults: results,
        totalScore: score,
        totalWeight: weight,
      };
    }

    // Build cost matrix (higher score = lower cost)
    const maxWeight = this.getMaxPairWeight(rubric);
    const costMatrix: number[][] = [];
    const pairScores: {
      results: CriticResult[];
      score: number;
      weight: number;
    }[][] = [];

    for (let i = 0; i < n; i++) {
      costMatrix[i] = [];
      pairScores[i] = [];
      for (let j = 0; j < m; j++) {
        const pair = this.scorePair(expected[i], actual[j], rubric);
        pairScores[i][j] = pair;
        // Cost = maxWeight - score (to minimize cost = maximize score)
        costMatrix[i][j] = maxWeight - pair.score;
      }
    }

    const assignment = hungarian(costMatrix);

    let totalScore = 0;
    let totalWeight = 0;
    const allResults: CriticResult[] = [];

    for (const [ei, ai] of assignment) {
      const pair = pairScores[ei][ai];
      totalScore += pair.score;
      totalWeight += pair.weight;
      allResults.push(...pair.results);
    }

    return { assignment, allResults, totalScore, totalWeight };
  }

  private scorePair(
    expected: ExpectedToolCall,
    actual: ActualToolCall,
    rubric: ResolvedEvalRubric,
  ): { results: CriticResult[]; score: number; weight: number } {
    const results: CriticResult[] = [];
    let score = 0;
    let weight = 0;

    // Tool name matching score
    const nameMatch = compareToolNames(expected.toolName, actual.name);
    const nameScore = nameMatch ? rubric.toolSelectionWeight : 0;
    score += nameScore;
    weight += rubric.toolSelectionWeight;

    results.push({
      field: "__tool_name__",
      match: nameMatch,
      score: nameScore,
      weight: rubric.toolSelectionWeight,
      expected: expected.toolName,
      actual: actual.name,
    });

    // Evaluate each critic
    for (const critic of this.critics) {
      const expectedVal = expected.args[critic.field];
      const actualVal = actual.args[critic.field];
      const result = critic.evaluate(expectedVal, actualVal);
      results.push(result);
      score += result.score;
      weight += result.weight;
    }

    return { results, score, weight };
  }

  private getMaxPairWeight(rubric: ResolvedEvalRubric): number {
    let w = rubric.toolSelectionWeight;
    for (const critic of this.critics) {
      w += critic.weight;
    }
    return w;
  }
}
