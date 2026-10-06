// The gold-tree oracle: a fake Jev that answers every question with the treebank's answer.
// It is a plumbing test, not a model: with perfect answers, a strategy should rebuild the gold tree
// (less whatever its code rules get wrong). Its numbers say nothing about Jev.

import type { QuestionMeta } from "./calls.ts";
import type { Gold } from "./gold.ts";
import { MockJevClient, noul, peakedChoice } from "./jev/mock.ts";
import { QUESTION_SETS } from "./question-sets/index.ts";

export function oracleClient(gold: Gold, mass = 0.9): MockJevClient {
  return new MockJevClient((id, q, request) => {
    const meta = (request.meta as Record<string, QuestionMeta> | undefined)?.[id];
    const set = meta ? QUESTION_SETS[meta.set] : undefined;
    if (!meta || !set) return undefined;
    const right = set.expected(meta, gold);
    if (q.type === "noul") return typeof right === "boolean" ? noul(right ? mass : 1 - mass) : undefined;
    if (q.type === "choice") return peakedChoice(Object.keys(q.criteria), typeof right === "string" ? right : undefined, mass);
    return undefined;
  });
}
