// Turning answers into readings: a value, a probability, and a confidence.
//
// Confidence follows TypeSafe's formulas (https://docs.typesafe.ai/confidence.md):
//   Choice: (p_max − 1/n) / (1 − 1/n)
//   Score:  max(0, 1 − Σ p_i |i − m| / MAD_uniform), m the most likely level
//   Noul:   |2p − 1|
// A result built from several answers is only as sure as its least sure part.

import type { Answer } from "./system-one.ts";

export interface ChoiceReading<K extends string = string> {
  value: K;
  /** Probability of the chosen option. */
  probability: number;
  confidence: number;
  probabilities: Record<K, number>;
  /** Options from most to least likely. */
  ranked: [K, number][];
}

export interface NoulReading {
  /** True when the probability is above 0.5. */
  value: boolean;
  /** Probability that the statement is true. */
  probability: number;
  confidence: number;
}

export interface ScoreReading {
  /** Expected level: the probability-weighted mean of the level numbers (0 = first level). */
  value: number;
  /** The most likely level. */
  level: number;
  confidence: number;
  /** Probability of each level, lowest first. */
  probabilities: number[];
}

export function readChoice<K extends string = string>(a: Answer | undefined): ChoiceReading<K> {
  if (!a || !("probabilities" in a) || "score" in a) throw new Error("expected a Choice answer");
  const probabilities = a.probabilities as Record<K, number>;
  const ranked = (Object.entries(probabilities) as [K, number][]).sort((x, y) => y[1] - x[1]);
  const [value, probability] = ranked[0] ?? [a.choice as K, 1];
  return { value, probability, confidence: choiceConfidence(Object.values(probabilities)), probabilities, ranked };
}

export function readNoul(a: Answer | undefined): NoulReading {
  if (!a || !("noul" in a)) throw new Error("expected a Noul answer");
  return { value: a.noul > 0.5, probability: a.noul, confidence: noulConfidence(a.noul) };
}

export function readScore(a: Answer | undefined): ScoreReading {
  if (!a || !("score" in a)) throw new Error("expected a Score answer");
  const keys = Object.keys(a.probabilities);
  const ordered = keys.every((k) => /^\d+$/.test(k)) ? keys.sort((x, y) => Number(x) - Number(y)) : keys;
  const probabilities = ordered.map((k) => a.probabilities[k] ?? 0);
  let level = 0;
  probabilities.forEach((p, i) => {
    if (p > (probabilities[level] ?? 0)) level = i;
  });
  return { value: a.score, level, confidence: scoreConfidence(probabilities), probabilities };
}

export function choiceConfidence(ps: number[]): number {
  const n = ps.length;
  if (n < 2) return 1;
  const pMax = Math.max(...ps);
  return Math.max(0, (pMax - 1 / n) / (1 - 1 / n));
}

export function scoreConfidence(ps: number[]): number {
  const n = ps.length;
  if (n < 2) return 1;
  let m = 0;
  ps.forEach((p, i) => {
    if (p > (ps[m] ?? 0)) m = i;
  });
  const spread = ps.reduce((s, p, i) => s + p * Math.abs(i - m), 0);
  const madUniform = ps.reduce((s, _, i) => s + Math.abs(i - (n - 1) / 2), 0) / n;
  return Math.max(0, 1 - spread / madUniform);
}

export function noulConfidence(p: number): number {
  return Math.abs(2 * p - 1);
}

/** The least sure of several confidences (1 when there are none). */
export function lowest(...confidences: (number | undefined)[]): number {
  const xs = confidences.filter((c): c is number => c !== undefined);
  return xs.length ? Math.min(...xs) : 1;
}

/**
 * Sort a probability into bands. With { no: 0.3, yes: 0.7 }: under 0.3 → "no", over 0.7 → "yes",
 * otherwise "uncertain", which the self-consistency cookbooks send to a person. The cut-offs are
 * yours to set from the cost of each kind of mistake.
 */
export function band(p: number, cuts: { no: number; yes: number }): "yes" | "no" | "uncertain" {
  if (p < cuts.no) return "no";
  if (p > cuts.yes) return "yes";
  return "uncertain";
}

/**
 * What to do with a Choice: "act" at or above `act`, "confirm" at or above `confirm`, otherwise
 * "person". Use per-option cut-offs for options with different stakes, the way confidence-gated
 * routing asks more of a money transfer than of a balance check.
 */
export type Decision = "act" | "confirm" | "person";

export function decide<K extends string>(r: ChoiceReading<K>, cuts: { act: number; confirm: number } | ((value: K) => { act: number; confirm: number }), by: "confidence" | "probability" = "confidence"): Decision {
  const c = typeof cuts === "function" ? cuts(r.value) : cuts;
  const x = by === "confidence" ? r.confidence : r.probability;
  return x >= c.act ? "act" : x >= c.confirm ? "confirm" : "person";
}

/** A weighted sum of scores, each normalized to 0–1 by its number of levels. */
export function weighted(scores: Record<string, ScoreReading>, weights: Record<string, number>): number {
  let total = 0;
  let sum = 0;
  for (const [k, w] of Object.entries(weights)) {
    const s = scores[k];
    if (!s) throw new Error(`no score "${k}"`);
    total += w * (s.value / Math.max(1, s.probabilities.length - 1));
    sum += w;
  }
  return sum ? total / sum : 0;
}
