// matchRecords: do two records describeOption the same thing?
//
// The two records go side by side in the state, and one Score places the pair on three levels:
// different things, closely related but maybe not the same, or the same thing. The middle level is
// the one to word carefully: it's what sends a pair to a person instead of merging or dropping it.
// One Noul per field says which fields agree, so a person can see why. Compare numbers in code.
// Based on the approach in TypeSafe's "Knowledge graph entity alignment" cookbook.

import type { Json } from "../system-one.ts";
import { noul, score } from "../questions.ts";
import { readNoul, readScore } from "../readings.ts";
import { type Task } from "../task.ts";

export interface MatchOptions {
  /** What the records are, for the question text: "products", "customers", "orders". Default "things". */
  noun?: string;
  /** Fields to compare, by name, each with a short description ("the beer's name"). */
  fields?: Record<string, string>;
  /** Your own three level descriptions (different, maybe, same). */
  levels?: [string, string, string];
}

export interface Matched {
  /** "different", "review" (closely related; a person should decide) or "same". */
  verdict: "different" | "review" | "same";
  /** 0 (different) to 2 (same): the probability-weighted level. */
  score: number;
  confidence: number;
  /** Probability that each compared field agrees. */
  fields: Record<string, number>;
}

export function matchRecords(a: Json, b: Json, opts: MatchOptions = {}): Task<Matched> {
  const noun = opts.noun ?? "things";
  const levels = opts.levels ?? [
    `They describeOption two different ${noun}.`,
    `They describeOption closely related ${noun} that may or may not be the same one: a variant, a different edition, or details that could fit either.`,
    `They describeOption one and the same ${noun.replace(/s$/, "")}.`,
  ];
  const fields = opts.fields ?? {};
  return {
    parts: { a, b },
    questions: (at) => {
      const qs: Record<string, ReturnType<typeof score> | ReturnType<typeof noul>> = {
        link: score(`How do ${at("a")} and ${at("b")} relate?`, levels),
      };
      for (const [f, desc] of Object.entries(fields)) qs[`same.${f}`] = noul(`${at("a")} and ${at("b")} give the same ${desc}.`);
      return qs;
    },
    read: (ans) => {
      const s = readScore(ans.link);
      const level = Math.round(s.value);
      return {
        verdict: level <= 0 ? "different" : level === 1 ? "review" : "same",
        score: s.value,
        confidence: s.confidence,
        fields: Object.fromEntries(Object.keys(fields).map((f) => [f, readNoul(ans[`same.${f}`]).probability])),
      };
    },
  };
}
