// Question set: WORD TYPE — "What kind of word is this?"
//
// One Choice per word over the 17 Universal Dependencies word types (noun, verb, adjective, ...).
// Two shapes:
//   flat:   one question with all 17 options
//   nested: first "content word / function word / other" (3 options), then the exact type within
//           that group; the two answers are combined with TypeSafe's tree rule (geometric mean of
//           the probabilities along the path). https://docs.typesafe.ai/cookbooks/hierarchical_classification.md
// Comparing them tests when a nested Choice beats one flat list.

import { type Answers, choiceOf, type QuestionBatch, type QuestionMeta } from "../../../lab/calls.ts";
import { composeTwoLevel, separation } from "../../../lab/jev/confidence.ts";
import type { Gold } from "../gold.ts";
import { type Sentence, wordRef } from "../sentence.ts";
import { UPOS, UPOS_DESCRIPTIONS, UPOS_GROUP_DESCRIPTIONS, UPOS_GROUPS, type UposGroup, uposGroupOf } from "../ud/upos.ts";

export const ID = "word-type";
export const TITLE = "What kind of word is this?";

export type Shape = "flat" | "nested";

export interface WordType {
  id: number;
  form: string;
  /** Jev's pick (a UPOS tag). */
  type: string;
  /** Probability per tag. */
  dist: Record<string, number>;
  /** Top / second probability. */
  separation: number;
}

export function ask(s: Sentence, shape: Shape = "flat"): QuestionBatch {
  const batch: QuestionBatch = {};
  s.words.forEach((_, i) => {
    const id = i + 1;
    const ref = wordRef(id);
    const meta = (level: string): QuestionMeta => ({ set: ID, word: id, level });
    if (shape === "flat") {
      batch[`pos_w${id}`] = {
        question: {
          type: "choice",
          instructions: `What part of speech is ${ref} as it is used in \`sentence\`?`,
          criteria: Object.fromEntries(UPOS.map((t) => [t, UPOS_DESCRIPTIONS[t]])),
        },
        meta: meta("type"),
      };
      return;
    }
    batch[`pos_w${id}_group`] = {
      question: {
        type: "choice",
        instructions: `What kind of word is ${ref} as it is used in \`sentence\`?`,
        criteria: { ...UPOS_GROUP_DESCRIPTIONS },
      },
      meta: meta("group"),
    };
    for (const [g, tags] of Object.entries(UPOS_GROUPS) as [UposGroup, readonly string[]][]) {
      batch[`pos_w${id}_${g}`] = {
        question: {
          type: "choice",
          instructions: `Suppose ${ref} is ${groupPhrase(g)} as it is used in \`sentence\`. Which part of speech is it?`,
          criteria: Object.fromEntries(tags.map((t) => [t, UPOS_DESCRIPTIONS[t as keyof typeof UPOS_DESCRIPTIONS]])),
        },
        meta: meta(g),
      };
    }
  });
  return batch;
}

function groupPhrase(g: UposGroup): string {
  return g === "open" ? "an open-class (content) word" : g === "closed" ? "a closed-class (function) word" : "not an ordinary word";
}

export function read(s: Sentence, answers: Answers, shape: Shape = "flat"): WordType[] {
  return s.words.map((form, i) => {
    const id = i + 1;
    if (shape === "flat") {
      const a = choiceOf(answers, `pos_w${id}`);
      const type = topOf(a.probabilities);
      return { id, form, type, dist: a.probabilities, separation: separation(Object.values(a.probabilities)) };
    }
    const group = choiceOf(answers, `pos_w${id}_group`).probabilities;
    const fine: Record<string, Record<string, number>> = {};
    for (const g of Object.keys(UPOS_GROUPS)) fine[g] = choiceOf(answers, `pos_w${id}_${g}`).probabilities;
    const c = composeTwoLevel(group, fine);
    return { id, form, type: c.best, dist: c.distribution, separation: c.separation };
  });
}

/** The option the treebank says is right. */
export function expected(meta: QuestionMeta, gold: Gold): string | undefined {
  const tag = gold.words[(meta.word ?? 0) - 1]?.upos;
  if (!tag) return undefined;
  if (meta.level === "type") return tag;
  const group = uposGroupOf(tag as (typeof UPOS)[number]);
  if (meta.level === "group") return group;
  return meta.level === group ? tag : undefined; // the fine question for the wrong group has no right answer
}

export function topOf(dist: Record<string, number>): string {
  let best = "";
  let bestP = -1;
  for (const [k, p] of Object.entries(dist)) {
    if (p > bestP) {
      bestP = p;
      best = k;
    }
  }
  return best;
}
