import { describe, expect, it } from "vitest";
import { hungarian } from "../../src/evals/hungarian.js";

describe("hungarian", () => {
	it("returns empty for empty matrix", () => {
		expect(hungarian([])).toEqual([]);
	});

	it("solves 1x1 matrix", () => {
		expect(hungarian([[5]])).toEqual([[0, 0]]);
	});

	it("solves 2x2 matrix", () => {
		// Optimal: row 0 → col 1 (cost 1), row 1 → col 0 (cost 2) = 3
		const result = hungarian([
			[4, 1],
			[2, 3],
		]);
		expect(result).toHaveLength(2);

		const totalCost = result.reduce(
			(sum, [r, c]) =>
				sum +
				[
					[4, 1],
					[2, 3],
				][r][c],
			0,
		);
		expect(totalCost).toBe(3);
	});

	it("solves 3x3 matrix", () => {
		const cost = [
			[1, 2, 3],
			[2, 4, 6],
			[3, 6, 9],
		];
		const result = hungarian(cost);
		expect(result).toHaveLength(3);

		// Each row and column should appear exactly once
		const rows = result.map(([r]) => r).sort();
		const cols = result.map(([, c]) => c).sort();
		expect(rows).toEqual([0, 1, 2]);
		expect(cols).toEqual([0, 1, 2]);
	});

	it("handles rectangular matrix (more rows than cols)", () => {
		const cost = [
			[1, 2],
			[3, 4],
			[5, 6],
		];
		const result = hungarian(cost);
		// Can only assign 2 pairs (limited by columns)
		expect(result).toHaveLength(2);
	});

	it("handles rectangular matrix (more cols than rows)", () => {
		const cost = [
			[1, 2, 3],
			[4, 5, 6],
		];
		const result = hungarian(cost);
		// Can only assign 2 pairs (limited by rows)
		expect(result).toHaveLength(2);
	});

	it("finds optimal assignment with clear minimum", () => {
		// Diagonal is optimal (cost = 3)
		const cost = [
			[1, 100, 100],
			[100, 1, 100],
			[100, 100, 1],
		];
		const result = hungarian(cost);
		const totalCost = result.reduce((sum, [r, c]) => sum + cost[r][c], 0);
		expect(totalCost).toBe(3);
	});

	it("handles zero-cost matrix", () => {
		const cost = [
			[0, 0],
			[0, 0],
		];
		const result = hungarian(cost);
		expect(result).toHaveLength(2);
	});
});
