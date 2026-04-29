import { describe, expect, it } from "vitest";
import { computePca2D } from "./pca";

describe("computePca2D", () => {
  it("returns one point per input vector", () => {
    const out = computePca2D([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    expect(out).toHaveLength(3);
    expect(out[0]).toHaveLength(2);
  });

  it("preserves separation: clearly distinct vectors map to distinct (x, y)", () => {
    const out = computePca2D([
      [1, 0, 0, 0],
      [10, 0, 0, 0],
      [0, 10, 0, 0],
      [0, 0, 10, 0],
    ]);
    // Pairwise distances should all be > 0.1
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const dx = out[i][0] - out[j][0];
        const dy = out[i][1] - out[j][1];
        expect(Math.hypot(dx, dy)).toBeGreaterThan(0.1);
      }
    }
  });

  it("handles fewer than 3 vectors by returning whatever it can (caller may warn)", () => {
    const out = computePca2D([[1, 2, 3]]);
    expect(out).toHaveLength(1);
  });

  it("runs ≤ 30 vectors × 1024 dims in under 250ms", () => {
    // Empirical target is <50ms on idle hardware; allow 5× headroom for
    // CI / shared-machine scheduling jitter.
    const vecs = Array.from({ length: 30 }, () =>
      Array.from({ length: 1024 }, () => Math.random()),
    );
    const t0 = performance.now();
    computePca2D(vecs);
    expect(performance.now() - t0).toBeLessThan(250);
  });
});
