// Question set: DIRECTION — "Where is the word this word attaches to?"
//
// One small Choice per word (up to 5 options): the word just before it, a word further back, the
// word just after it, a word further ahead, or none (it's the main word). It asks the same thing
// as attach-to, broken into a coarse, position-only question. Its answer votes on every possible
// head: "further back" spreads its probability evenly over all the words further back, and so on.

import { type Answers, choiceOf, type QuestionBatch, type QuestionMeta } from "../../../lab/calls.ts";
import type { Gold } from "../gold.ts";
import { describeWord, type Sentence, wordRef } from "../sentence.ts";
import type { HeadDist } from "../votes.ts";
import { type Hints, hintText } from "./attach-to.ts";

export const ID = "direction";
export const TITLE = "Where is the word this word attaches to?";

type Where = "just-before" | "further-before" | "just-after" | "further-after" | "main";

export function ask(s: Sentence, hints: Hints = "v1"): QuestionBatch {
  const n = s.words.length;
  const batch: QuestionBatch = {};
  for (let d = 1; d <= n; d++) {
    if (n === 1) continue;
    const ref = wordRef(d);
    const criteria: Record<string, string> = {};
    const options: Record<string, string> = {};
    const add = (k: Where, text: string) => {
      criteria[k] = text;
      options[k] = k;
    };
    if (d > 1) add("just-before", `The word just before it: ${describeWord(s.words, d - 1)}.`);
    if (d > 2) add("further-before", `A word further back, before ${wordRef(d - 1)}.`);
    if (d < n) add("just-after", `The word just after it: ${describeWord(s.words, d + 1)}.`);
    if (d < n - 1) add("further-after", `A word further ahead, after ${wordRef(d + 1)}.`);
    add("main", `None: ${ref} is the main word (predicate) of the whole sentence.`);
    batch[`dir_w${d}`] = {
      question: {
        type: "choice",
        instructions: `In \`sentence\`, where is the word that ${ref} attaches to as a modifier, argument or function word?${hintText(hints)}`,
        criteria,
      },
      meta: { set: ID, word: d, options },
    };
  }
  return batch;
}

/** Each answer as a vote over heads: a class's probability is split evenly among its words. */
export function read(s: Sentence, answers: Answers): Map<number, HeadDist> {
  const n = s.words.length;
  const out = new Map<number, HeadDist>();
  for (let d = 1; d <= n; d++) {
    if (!answers[`dir_w${d}`]) continue;
    const p = choiceOf(answers, `dir_w${d}`).probabilities;
    const dist: HeadDist = {};
    const spread = (ids: number[], mass: number) => {
      for (const h of ids) dist[h] = (dist[h] ?? 0) + mass / ids.length;
    };
    if (p["just-before"] !== undefined) spread([d - 1], p["just-before"]);
    if (p["further-before"] !== undefined) spread(ids(1, d - 2), p["further-before"]);
    if (p["just-after"] !== undefined) spread([d + 1], p["just-after"]);
    if (p["further-after"] !== undefined) spread(ids(d + 2, n), p["further-after"]);
    if (p.main !== undefined) spread([0], p.main);
    out.set(d, dist);
  }
  return out;
}

function ids(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

export function whereOf(word: number, head: number): Where {
  if (head === 0) return "main";
  if (head === word - 1) return "just-before";
  if (head < word) return "further-before";
  if (head === word + 1) return "just-after";
  return "further-after";
}

export function expected(meta: QuestionMeta, gold: Gold): string | undefined {
  const d = meta.word ?? 0;
  const head = gold.words[d - 1]?.head;
  if (head === undefined) return undefined;
  return whereOf(d, head);
}
