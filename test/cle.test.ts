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

  test("single root with banned heads: never falls back to a second root", () => {
    // Like the "function words can't be heads" rule: some words can't be anyone's head. Then some
    // choices of main word leave part of the sentence unreachable, and those must lose.
    const rand = rng(11);
    for (let trial = 0; trial < 300; trial++) {
      const n = 2 + Math.floor(rand() * 4);
      const s = randomScores(n, rand);
      const banned = Array.from({ length: n }, (_, i) => i + 1).filter(() => rand() < 0.4);
      if (banned.length === n) banned.pop();
      for (const h of banned) for (let d = 1; d <= n; d++) (s[h] as number[])[d] = -1e9;
      const { heads, score } = decodeSingleRoot(s);
      expect(findCycle(heads)).toBeUndefined();
      expect(heads.filter((h, d) => d > 0 && h === 0).length).toBe(1);
      expect(score).toBeCloseTo(bruteForce(s, true), 6);
    }
  });

  test("regression: 'Attached is an image of the GISB.' gets one main word", () => {
    // Jev's top answer for "is" is root, but "is" (AUX) is banned as a head, so with "is" as the
    // only main word nothing can reach "Attached", "image" or "GISB".
    const P: Record<number, Record<number, number>> = {
      1: { 0: 0.16, 2: 0.545, 4: 0.283, 8: 0.0101 },
      2: { 0: 0.4, 1: 0.22, 4: 0.37, 7: 0.01 },
      3: { 4: 0.99999 },
      4: { 0: 0.13, 1: 0.08, 2: 0.29, 3: 0.25, 5: 0.24, 7: 0.01 },
      5: { 2: 0.01, 4: 0.7, 6: 0.02, 7: 0.27 },
      6: { 4: 0.07, 5: 0.01, 7: 0.92 },
      7: { 0: 0.01, 2: 0.01, 4: 0.09, 5: 0.77, 6: 0.11, 8: 0.01 },
      8: { 0: 0.07, 1: 0.44, 2: 0.07, 4: 0.04, 7: 0.38 },
    };
    const banned = new Set([2, 3, 5, 6, 8]);
    const s = Array.from({ length: 9 }, (_, h) =>
      Array.from({ length: 9 }, (_, d) => (d === 0 || h === d || banned.has(h) ? -1e9 : Math.log(Math.max(P[d]?.[h] ?? 0, 1e-6)))),
    );
    const { heads } = decodeSingleRoot(s);
    expect(heads.filter((h, d) => d > 0 && h === 0)).toEqual([0]);
    expect(heads[4]).toBe(0); // "image" is the main word; "is" attaches to it
    expect(heads[2]).toBe(4);
  });
});
