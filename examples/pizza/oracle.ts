// A fake Jev that answers every pizza question from the answer key. Like the parser's oracle, it's
// a plumbing check: with perfect answers, a strategy should reproduce the answer key, less whatever
// its code gets wrong. Its numbers say nothing about Jev.

import type { QuestionMeta } from "../../src/calls.ts";
import { MockJevClient, noul, peakedChoice } from "../../src/jev/mock.ts";
import type { PizzaGold } from "./gold.ts";
import { PIZZA_QUESTION_SETS, WORD_TAG, WORD_TAG_FOLLOW_UP } from "./questions.ts";

export function pizzaOracle(gold: PizzaGold, mass = 0.9): MockJevClient {
  return new MockJevClient((id, q, request) => {
    const meta = (request.meta as Record<string, QuestionMeta> | undefined)?.[id];
    const set = meta ? PIZZA_QUESTION_SETS[meta.set] : undefined;
    if (!meta || !set) return undefined;
    let right = set.expected(meta, gold);
    // Words the answer key doesn't label ("with", "and") are filler as far as the order goes.
    if (right === undefined && (meta.set === WORD_TAG || meta.set === WORD_TAG_FOLLOW_UP) && (meta.level === "tag" || meta.level === "kind")) right = "none";
    if (q.type === "noul") return typeof right === "boolean" ? noul(right ? mass : 1 - mass) : undefined;
    if (q.type === "choice") return peakedChoice(Object.keys(q.criteria), typeof right === "string" ? right : undefined, mass);
    return undefined;
  });
}
