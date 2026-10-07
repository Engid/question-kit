// Question set: ATTACH TO — "Which word does this word attach to?"
//
// One Choice per word. The options are the candidate words (by default every other word in the
// sentence) plus "root" ("none: this is the main word of the sentence"). Each option is the word's
// path plus a little context, e.g.  `words.w6` ("ball", after "red").
//
// Knobs, each a question-design experiment:
//   candidates  which words to offer (all of them, or a short list proposed by code)
//   order       option order: sentence order, reversed, or both (asked twice and averaged).
//               TypeSafe documents that jev-1.13 "leans toward the option that comes first":
//               https://docs.typesafe.ai/model-jaggedness/jev-1.13.md
//   hints       how much of Universal Dependencies' attachment convention to spell out.
//               UD makes content words the heads ("across" attaches to "yard"), which differs
//               from school grammar: https://universaldependencies.org/u/overview/syntax.html

import { type Answers, choiceOf, type QuestionBatch } from "../../../lab/calls.ts";
import type { Gold } from "../gold.ts";
import type { Entry } from "../../../lab/jev/types.ts";
import { MAX_CHOICE_OPTIONS } from "../../../lab/jev/types.ts";
import { describeWord, range, type Sentence, wordKey, wordRef } from "../sentence.ts";
import type { HeadDist } from "../votes.ts";
import type { QuestionMeta } from "../../../lab/calls.ts";

export const ID = "attach-to";
export const TITLE = "Which word does this word attach to?";

export type Order = "sentence" | "reversed" | "both";
export type Hints = "none" | "v1" | "v2";

export interface Options {
  order?: Order;
  hints?: Hints;
  /** Candidate heads for a word (word ids; 0 = root). Default: every other word, plus root. */
  candidates?: (word: number) => number[];
}

/** UD's attachment conventions in plain words (v1: the first version we tried). */
export const HINTS_V1 = [
  "Use Universal Dependencies conventions: content words are heads, and function words attach to the content word they belong with.",
  "A determiner, adjective or number attaches to its noun.",
  "A preposition attaches to the noun it introduces, not to the verb.",
  "An auxiliary attaches to its main verb. When \"be\" links a subject to a noun or adjective, that noun or adjective is the head and \"be\" attaches to it.",
  "In a coordination like \"X, Y and Z\", Y and Z attach to X, and each comma or conjunction attaches to the conjunct after it.",
  "Other punctuation attaches to the head of the clause or phrase it ends or sets off.",
].join(" ");

/**
 * v2 also says what the content word attaches to, after the first live test showed Jev attaching
 * "across" to "yard" (as v1 asks) and "yard" to "across" (school grammar) at the same time.
 */
export const HINTS_V2 = [
  "Use Universal Dependencies conventions: content words are heads, and function words attach to the content word they belong with. A function word is never the head of a content word.",
  "A determiner, adjective or number attaches to its noun.",
  "A preposition attaches to the noun it introduces. That noun attaches to the word its phrase modifies (usually a verb or another noun), never to the preposition.",
  "A subordinating word (\"if\", \"because\", \"that\", infinitive \"to\") attaches to the verb of its own clause. That verb attaches to the word the clause modifies, never to the subordinating word.",
  "An auxiliary attaches to its main verb. When \"be\" links a subject to a noun or adjective, that noun or adjective is the head and \"be\" attaches to it.",
  "In a coordination like \"X, Y and Z\", Y and Z attach to X, and each comma or conjunction attaches to the conjunct after it.",
  "Other punctuation attaches to the head of the clause or phrase it ends or sets off.",
].join(" ");

export function hintText(hints: Hints): string {
  return hints === "none" ? "" : ` ${hints === "v1" ? HINTS_V1 : HINTS_V2}`;
}

export const ROOT = "root";

export function ask(s: Sentence, o: Options = {}): QuestionBatch {
  const n = s.words.length;
  const order = o.order ?? "sentence";
  const hints = o.hints ?? "v1";
  if (n + 1 > MAX_CHOICE_OPTIONS) throw new Error(`sentence has ${n} words; a Choice allows ${MAX_CHOICE_OPTIONS} options`);
  const batch: QuestionBatch = {};
  for (let d = 1; d <= n; d++) {
    const cands = (o.candidates?.(d) ?? range(0, n)).filter((h) => h !== d);
    if (cands.length < 2) continue; // only one possible answer: nothing to ask
    const words = cands.filter((h) => h !== 0).sort((a, b) => a - b);
    const hasRoot = cands.includes(0);
    const ref = wordRef(d);
    const build = (ids: number[]) => {
      const criteria: Record<string, Entry> = {};
      const options: Record<string, number> = {};
      for (const h of ids) {
        criteria[wordKey(h)] = describeWord(s.words, h);
        options[wordKey(h)] = h;
      }
      if (hasRoot) {
        criteria[ROOT] = `None: ${ref} is the main word (predicate) of the whole sentence.`;
        options[ROOT] = 0;
      }
      const instructions =
        `In \`sentence\`, which word is the head of ${ref}, the word that ${ref} attaches to as a modifier, argument or function word? ` +
        `Choose root only if ${ref} is the main predicate of the whole sentence.` +
        hintText(hints);
      const meta: QuestionMeta = { set: ID, word: d, options };
      return { question: { type: "choice" as const, instructions, criteria }, meta };
    };
    if (order === "reversed") {
      batch[`head_w${d}`] = build([...words].reverse());
    } else {
      batch[`head_w${d}`] = build(words);
      if (order === "both") batch[`head_w${d}_rev`] = build([...words].reverse());
    }
  }
  return batch;
}

/** For each word, Jev's probability for each head (averaging the two orders when asked twice). */
export function read(s: Sentence, answers: Answers): Map<number, HeadDist> {
  const out = new Map<number, HeadDist>();
  for (let d = 1; d <= s.words.length; d++) {
    if (!answers[`head_w${d}`]) {
      out.set(d, { 0: 1 }); // not asked: the root was the only candidate
      continue;
    }
    const first = toHeads(choiceOf(answers, `head_w${d}`).probabilities);
    const rev = answers[`head_w${d}_rev`] ? toHeads(choiceOf(answers, `head_w${d}_rev`).probabilities) : undefined;
    if (!rev) {
      out.set(d, first);
      continue;
    }
    const avg: HeadDist = {};
    for (const h of Object.keys(first)) avg[Number(h)] = ((first[Number(h)] ?? 0) + (rev[Number(h)] ?? 0)) / 2;
    out.set(d, avg);
  }
  return out;
}

function toHeads(probs: Record<string, number>): HeadDist {
  const out: HeadDist = {};
  for (const [opt, p] of Object.entries(probs)) out[opt === ROOT ? 0 : Number(opt.slice(1))] = p;
  return out;
}

/** The right option per the treebank, or undefined when the right head wasn't offered. */
export function expected(meta: QuestionMeta, gold: Gold): string | undefined {
  const head = gold.words[(meta.word ?? 0) - 1]?.head;
  if (head === undefined) return undefined;
  return Object.entries(meta.options ?? {}).find(([, h]) => h === head)?.[0];
}
