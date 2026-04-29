/**
 * 2D PCA via power iteration with deflation. Pure TS, no deps.
 *
 * Centres data, finds the leading eigenvector of the covariance matrix
 * by projection-style power iteration (Av = sum_x x · (x · v)), then
 * deflates and repeats for the second component. ~80 lines, runs in
 * under 50ms for typical Playground sizes (≤30 × ≤4096).
 */
export function computePca2D(vectors: number[][]): [number, number][] {
  const n = vectors.length;
  if (n === 0) return [];
  const d = vectors[0].length;
  if (d === 0) return vectors.map(() => [0, 0] as [number, number]);

  // Centre
  const mean = new Array<number>(d).fill(0);
  for (const v of vectors) for (let i = 0; i < d; i++) mean[i] += v[i];
  for (let i = 0; i < d; i++) mean[i] /= n;
  const X: number[][] = vectors.map((v) => v.map((x, i) => x - mean[i]));

  const v1 = powerIteration(X, d);
  // Project onto v1, subtract from each row to deflate
  const Xdef: number[][] = X.map((row) => {
    const proj = dot(row, v1);
    return row.map((x, i) => x - proj * v1[i]);
  });
  const v2 = powerIteration(Xdef, d);

  return X.map((row) => [dot(row, v1), dot(row, v2)]);
}

function powerIteration(X: number[][], d: number, iters = 50): number[] {
  // Start with a deterministic but non-degenerate vector
  let v = new Array<number>(d).fill(0).map((_, i) => Math.sin(i + 1));
  v = normalise(v);
  for (let it = 0; it < iters; it++) {
    // u = X^T X v  =  sum over rows of (row · v) * row
    const u = new Array<number>(d).fill(0);
    for (const row of X) {
      const s = dot(row, v);
      for (let i = 0; i < d; i++) u[i] += s * row[i];
    }
    const next = normalise(u);
    // Convergence check: cosine similarity ≈ 1
    if (dot(next, v) > 1 - 1e-9) return next;
    v = next;
  }
  return v;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function normalise(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  if (n < 1e-12) {
    const r = v.slice();
    r[0] = 1;
    return r;
  }
  return v.map((x) => x / n);
}
