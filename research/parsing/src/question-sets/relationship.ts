// Question set: RELATIONSHIP — "How does this word relate to the word it attaches to?"
//
// UD names 37 relationships (subject, object, determiner, ...). Asking all of them at once would
// be one big flat Choice, so this set is nested, like a tree:
//   kind:     7 broad kinds (core argument, noun modifier, function word, ...)
//   specific: one Choice per kind, over that kind's relationships (2–7 options each)
// All 8 questions go in the same request; the specific answers for the wrong kinds are ignored,
// and the two levels are combined with TypeSafe's tree rule (geometric mean along the path):
// https://docs.typesafe.ai/cookbooks/hierarchical_classification.md
//
// The 7 kinds are our own grouping of UD's relation table (https://universaldependencies.org/u/dep/).

import { type Answers, choiceOf, type QuestionBatch, type QuestionMeta } from "../../../lab/calls.ts";
import { composeTwoLevel } from "../../../lab/jev/confidence.ts";
import type { Gold } from "../gold.ts";
import { type Sentence, wordRef } from "../sentence.ts";
import {
  DEPREL_DESCRIPTIONS,
  DEPREL_GROUP_DESCRIPTIONS,
  DEPREL_GROUP_LABELS,
  DEPREL_GROUPS,
  type DeprelGroup,
  deprelGroupOf,
} from "../ud/deprel.ts";

export const ID = "relationship";
export const TITLE = "How does this word relate to the word it attaches to?";

export interface Relationship {
  /** The relationship Jev picked, e.g. "nsubj". */
  rel: string;
  /** Combined probability per relationship. */
  dist: Record<string, number>;
  separation: number;
}

/**
 * Questions for each attachment [word, head]. With `head` undefined, the questions don't name the
 * word it attaches to (for strategies that ask everything in one call, before attachments are known).
 */
export function ask(s: Sentence, links: [word: number, head: number | undefined][]): QuestionBatch {
  const batch: QuestionBatch = {};
  for (const [dep, head] of links) {
    if (head === 0) continue; // the main word's relationship is always "root"
    const d = wordRef(dep);
    const lead = head === undefined ? `In \`sentence\`, consider ${d} and the word it depends on.` : `In \`sentence\`, ${d} depends on ${wordRef(head)}.`;
    const to = head === undefined ? `to the word it depends on` : `to ${wordRef(head)}`;
    const meta = (level: string): QuestionMeta => ({ set: ID, word: dep, ...(head !== undefined ? { head } : {}), level });
    batch[`rel_w${dep}_group`] = {
      question: { type: "choice", instructions: `${lead} What kind of dependent is ${d} ${to}?`, criteria: { ...DEPREL_GROUP_DESCRIPTIONS } },
      meta: meta("kind"),
    };
    for (const [g, rels] of Object.entries(DEPREL_GROUPS) as [DeprelGroup, readonly string[]][]) {
      batch[`rel_w${dep}_${g}`] = {
        question: {
          type: "choice",
          instructions: `${lead} Suppose ${d} is ${DEPREL_GROUP_LABELS[g]}. Which relation does ${d} have ${to}?`,
          criteria: Object.fromEntries(rels.map((r) => [r, DEPREL_DESCRIPTIONS[r as keyof typeof DEPREL_DESCRIPTIONS]])),
        },
        meta: meta(g),
      };
    }
  }
  return batch;
}

/** The relationship for `word`, or undefined if it wasn't asked. */
export function read(answers: Answers, word: number): Relationship | undefined {
  if (!answers[`rel_w${word}_group`]) return undefined;
  const kind = choiceOf(answers, `rel_w${word}_group`).probabilities;
  const specific: Record<string, Record<string, number>> = {};
  for (const g of Object.keys(DEPREL_GROUPS)) specific[g] = choiceOf(answers, `rel_w${word}_${g}`).probabilities;
  const c = composeTwoLevel(kind, specific);
  return { rel: c.best, dist: c.distribution, separation: c.separation };
}

/**
 * The right option per the treebank. Only defined when the question names the right head (or no
 * head), since a relationship to the wrong word has no right answer.
 */
export function expected(meta: QuestionMeta, gold: Gold): string | undefined {
  const g = gold.words[(meta.word ?? 0) - 1];
  if (!g || g.head === 0) return undefined;
  if (meta.head !== undefined && meta.head !== g.head) return undefined;
  const group = deprelGroupOf(g.deprel);
  if (meta.level === "kind") return group;
  return meta.level === group ? g.deprel : undefined;
}
