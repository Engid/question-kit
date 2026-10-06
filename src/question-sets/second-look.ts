// Question set: SECOND LOOK — "Which of these two does this word attach to?"
//
// After the votes so far, some words have two close candidates. For each of those, Jev is asked
// to choose between just the two, twice, with the options in both orders, and the two answers are
// averaged. TypeSafe suggests reordering options to check an answer, since jev-1.13 "leans toward
// the option that comes first": https://docs.typesafe.ai/model-jaggedness/jev-1.13.md

import { type Answers, choiceOf, type QuestionBatch, type QuestionMeta } from "../calls.ts";
import type { Gold } from "../gold.ts";
import { describeWord, type Sentence, wordKey, wordRef } from "../sentence.ts";
import type { HeadDist, HeadVotes } from "../votes.ts";
import { type Hints, hintText } from "./attach-to.ts";

export const ID = "second-look";
export const TITLE = "Which of these two does this word attach to?";

/** Words whose two best candidates are within `ratio` of each other, with those two candidates. */
export function closeCalls(votes: HeadVotes, ratio = 3): [word: number, a: number, b: number][] {
  const out: [number, number, number][] = [];
  for (let d = 1; d <= votes.n; d++) {
    const ranked = Object.entries(votes.combined(d)).sort((x, y) => y[1] - x[1]);
    const [first, second] = ranked;
    if (!first || !second) continue;
    if (first[1] / Math.max(second[1], 1e-9) < ratio) out.push([d, Number(first[0]), Number(second[0])]);
  }
  return out;
}

export function ask(s: Sentence, calls: [number, number, number][], hints: Hints = "v1"): QuestionBatch {
  const batch: QuestionBatch = {};
  const label = (h: number) => (h === 0 ? "root" : wordKey(h));
  const text = (d: number, h: number) => (h === 0 ? `None: ${wordRef(d)} is the main word (predicate) of the whole sentence.` : describeWord(s.words, h));
  for (const [d, a, b] of calls) {
    const build = (x: number, y: number) => ({
      question: {
        type: "choice" as const,
        instructions: `In \`sentence\`, which word does ${wordRef(d)} attach to as a modifier, argument or function word?${hintText(hints)}`,
        criteria: { [label(x)]: text(d, x), [label(y)]: text(d, y) },
      },
      meta: { set: ID, word: d, options: { [label(x)]: x, [label(y)]: y } } satisfies QuestionMeta,
    });
    batch[`look_w${d}`] = build(a, b);
    batch[`look_w${d}_rev`] = build(b, a);
  }
  return batch;
}

export function read(answers: Answers, calls: [number, number, number][]): Map<number, HeadDist> {
  const out = new Map<number, HeadDist>();
  const head = (opt: string) => (opt === "root" ? 0 : Number(opt.slice(1)));
  for (const [d] of calls) {
    const dist: HeadDist = {};
    for (const id of [`look_w${d}`, `look_w${d}_rev`]) {
      for (const [opt, p] of Object.entries(choiceOf(answers, id).probabilities)) dist[head(opt)] = (dist[head(opt)] ?? 0) + p / 2;
    }
    out.set(d, dist);
  }
  return out;
}

export function expected(meta: QuestionMeta, gold: Gold): string | undefined {
  const head = gold.words[(meta.word ?? 0) - 1]?.head;
  return Object.entries(meta.options ?? {}).find(([, h]) => h === head)?.[0];
}
