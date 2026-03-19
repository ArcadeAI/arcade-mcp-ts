/**
 * Hungarian algorithm for optimal assignment in a cost matrix.
 *
 * Given an n×m cost matrix, finds the assignment of rows to columns
 * that minimizes total cost. Returns array of [row, col] pairs.
 *
 * Uses the classic O(n^3) algorithm with potential-based approach.
 * Fine for eval scoring where matrices are small (1-10 items).
 */
export function hungarian(costMatrix: number[][]): [number, number][] {
	const n = costMatrix.length;
	if (n === 0) return [];
	const m = costMatrix[0].length;
	if (m === 0) return [];

	// Pad to square
	const size = Math.max(n, m);
	const c: number[][] = [];
	for (let i = 0; i < size; i++) {
		c[i] = [];
		for (let j = 0; j < size; j++) {
			c[i][j] = i < n && j < m ? costMatrix[i][j] : 0;
		}
	}

	// u[i] = potential for row i, v[j] = potential for col j
	const u = new Float64Array(size + 1);
	const v = new Float64Array(size + 1);
	// p[j] = row assigned to col j (1-indexed, 0 = unassigned)
	const p = new Int32Array(size + 1);
	// way[j] = previous col in augmenting path
	const way = new Int32Array(size + 1);

	for (let i = 1; i <= size; i++) {
		// Start augmenting path from row i
		p[0] = i;
		let j0 = 0; // Virtual column

		const minv = new Float64Array(size + 1).fill(Number.MAX_VALUE);
		const used = new Uint8Array(size + 1);

		do {
			used[j0] = 1;
			const i0 = p[j0];
			let delta = Number.MAX_VALUE;
			let j1 = -1;

			for (let j = 1; j <= size; j++) {
				if (used[j]) continue;
				const cur = c[i0 - 1][j - 1] - u[i0] - v[j];
				if (cur < minv[j]) {
					minv[j] = cur;
					way[j] = j0;
				}
				if (minv[j] < delta) {
					delta = minv[j];
					j1 = j;
				}
			}

			for (let j = 0; j <= size; j++) {
				if (used[j]) {
					u[p[j]] += delta;
					v[j] -= delta;
				} else {
					minv[j] -= delta;
				}
			}

			j0 = j1;
		} while (p[j0] !== 0);

		// Update augmenting path
		do {
			const j1 = way[j0];
			p[j0] = p[j1];
			j0 = j1;
		} while (j0 !== 0);
	}

	// Extract result — only include original (non-padded) assignments
	const result: [number, number][] = [];
	for (let j = 1; j <= size; j++) {
		if (p[j] !== 0) {
			const row = p[j] - 1;
			const col = j - 1;
			if (row < n && col < m) {
				result.push([row, col]);
			}
		}
	}

	return result;
}
