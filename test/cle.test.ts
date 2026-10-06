import { describe, expect, test } from "bun:test";
import { chuLiuEdmonds, decodeSingleRoot, findCycle, treeScore } from "../src/decode/cle.ts";

// Deterministic PRNG so failures reproduce.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomScores(n: number, rand: () => number): number[][] {
  return Array.from({ length: n + 1 }, (_, h) =>
    Array.from({ length: n + 1 }, (_, d) => (d === 0 || h === d ? -1e9 : Math.log(rand() + 1e-6))),
  );
}

/** Every head assignment for n words, keeping only trees. */
function* allTrees(n: number): Generator<number[]> {
  const heads = new Array<number>(n + 1).fill(0);
  heads[0] = -1;
  const rec = function* (d: number): Generator<number[]> {
    if (d > n) {
      if (!findCycle(heads)) yield heads.slice();
      return;
    }
    for (let h = 0; h <= n; h++) {
      if (h === d) continue;
      heads[d] = h;
      yield* rec(d + 1);
    }
  };
  yield* rec(1);
}

function bruteForce(scores: number[][], singleRoot: boolean): number {
  const n = scores.length - 1;
  let best = -Infinity;
  for (const t of allTrees(n)) {
    if (singleRoot && t.filter((h, d) => d > 0 && h === 0).length !== 1) continue;
    best = Math.max(best, treeScore(scores, t));
  }
  return best;
}

describe("Chu-Liu/Edmonds", () => {
  test("returns a tree when the greedy heads already form one", () => {
    const s = [
      [-1e9, 0, -5, -5],
      [-1e9, -1e9, 0, -5],
      [-1e9, -5, -1e9, 0],
      [-1e9, -5, -5, -1e9],
    ];
    expect(chuLiuEdmonds(s)).toEqual([-1, 0, 1, 2]);
  });

  test("breaks a cycle", () => {
    // Words 1 and 2 prefer each other; the best tree enters the cycle from the root.
    const s = [
      [-1e9, -3, -1, -9],
      [-1e9, -1e9, 0, -2],
      [-1e9, 0, -1e9, -9],
      [-1e9, -9, -9, -1e9],
    ];
    const heads = chuLiuEdmonds(s);
    expect(findCycle(heads)).toBeUndefined();
    expect(treeScore(s, heads)).toBeCloseTo(bruteForce(s, false), 9);
  });

  test("matches brute force on random graphs (unconstrained)", () => {
    const rand = rng(42);
    for (let trial = 0; trial < 300; trial++) {
      const n = 1 + Math.floor(rand() * 5);
      const s = randomScores(n, rand);
      const heads = chuLiuEdmonds(s);
      expect(findCycle(heads)).toBeUndefined();
      expect(treeScore(s, heads)).toBeCloseTo(bruteForce(s, false), 9);
    }
  });

  test("matches brute force on random graphs with a single root", () => {
    const rand = rng(7);
    for (let trial = 0; trial < 300; trial++) {
      const n = 1 + Math.floor(rand() * 5);
      const s = randomScores(n, rand);
      const { heads, score } = decodeSingleRoot(s);
      expect(findCycle(heads)).toBeUndefined();
      expect(heads.filter((h, d) => d > 0 && h === 0).length).toBe(1);
      expect(score).toBeCloseTo(bruteForce(s, true), 9);
    }
  });
});
