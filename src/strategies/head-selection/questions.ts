// Question builders for the head-selection strategy. Every question is a closed Choice about one
// word, written with backticked paths into the state (`sentence`, `words.w3`), as TypeSafe's docs
// recommend: https://docs.typesafe.ai/primitives.md
//
// Nothing here knows any domain. The only linguistic knowledge is UD's tag and relation inventory,
// plus (optionally) a short statement of UD's attachment conventions.

import type { ChoiceQuestion, Entry, Json, Questions } from "../../jev/types.ts";
import { MAX_CHOICE_OPTIONS } from "../../jev/types.ts";
import {
  DEPREL_DESCRIPTIONS,
  DEPREL_GROUP_DESCRIPTIONS,
  DEPREL_GROUP_LABELS,
  DEPREL_GROUPS,
  type DeprelGroup,
} from "../../ud/deprel.ts";
import { UPOS, UPOS_DESCRIPTIONS, UPOS_GROUP_DESCRIPTIONS, UPOS_GROUPS, type UposGroup } from "../../ud/upos.ts";

export type WordContext = "path" | "neighbors";
export type OptionOrder = "sentence" | "reversed" | "both";

export const wordKey = (id: number) => `w${id}`;
export const wordRef = (id: number) => `\`words.w${id}\``;

/** The state every request sends: the sentence, and each word under `words.wN`. */
export function buildState(words: string[], text: string, context: WordContext): Entry {
  const ws: Record<string, Json> = {};
  words.forEach((w, i) => {
    ws[wordKey(i + 1)] =
      context === "path" ? w : { word: w, before: words[i - 1] ?? null, after: words[i + 1] ?? null };
  });
  return { sentence: text, words: ws };
}

// ---------------------------------------------------------------- part of speech

export const posId = (id: number) => `pos_w${id}`;
export const posGroupId = (id: number) => `pos_w${id}_group`;
export const posFineId = (id: number, g: UposGroup) => `pos_w${id}_${g}`;

export function posQuestions(n: number, mode: "flat" | "hierarchical"): Questions {
  const qs: Questions = {};
  for (let id = 1; id <= n; id++) {
    const ref = wordRef(id);
    if (mode === "flat") {
      qs[posId(id)] = {
        type: "choice",
        instructions: `What part of speech is ${ref} as it is used in \`sentence\`?`,
        criteria: Object.fromEntries(UPOS.map((t) => [t, UPOS_DESCRIPTIONS[t]])),
      };
      continue;
    }
    qs[posGroupId(id)] = {
      type: "choice",
      instructions: `What kind of word is ${ref} as it is used in \`sentence\`?`,
      criteria: { ...UPOS_GROUP_DESCRIPTIONS },
    };
    for (const [g, tags] of Object.entries(UPOS_GROUPS) as [UposGroup, readonly string[]][]) {
      qs[posFineId(id, g)] = {
        type: "choice",
        instructions: `Suppose ${ref} is ${groupPhrase(g)} as it is used in \`sentence\`. Which part of speech is it?`,
        criteria: Object.fromEntries(tags.map((t) => [t, UPOS_DESCRIPTIONS[t as keyof typeof UPOS_DESCRIPTIONS]])),
      };
    }
  }
  return qs;
}

function groupPhrase(g: UposGroup): string {
  return g === "open" ? "an open-class (content) word" : g === "closed" ? "a closed-class (function) word" : "not an ordinary word";
}

// ---------------------------------------------------------------- heads

export const headId = (id: number) => `head_w${id}`;
export const headRevId = (id: number) => `head_w${id}_rev`;
export const ROOT_OPTION = "root";

/**
 * UD's attachment conventions in plain words. They're grammar, not domain knowledge, and they
 * differ from school grammar (e.g. a preposition attaches to its noun, and a copula to its
 * predicate), so the strategy states them unless `hints` is "none".
 * Source: https://universaldependencies.org/u/overview/syntax.html
 */
export const UD_HEAD_HINTS_V1 = [
  "Use Universal Dependencies conventions: content words are heads, and function words attach to the content word they belong with.",
  "A determiner, adjective or number attaches to its noun.",
  "A preposition attaches to the noun it introduces, not to the verb.",
  "An auxiliary attaches to its main verb. When \"be\" links a subject to a noun or adjective, that noun or adjective is the head and \"be\" attaches to it.",
  "In a coordination like \"X, Y and Z\", Y and Z attach to X, and each comma or conjunction attaches to the conjunct after it.",
  "Other punctuation attaches to the head of the clause or phrase it ends or sets off.",
].join(" ");

/**
 * v2 adds the converse of each rule, after the first live smoke test (2026-10-06, one sentence):
 * Jev attached "across" to "yard" as v1 asks, but also "yard" to "across", and a subordinator
 * case went the same way. Each rule now also says what the content word attaches to.
 */
export const UD_HEAD_HINTS_V2 = [
  "Use Universal Dependencies conventions: content words are heads, and function words attach to the content word they belong with. A function word is never the head of a content word.",
  "A determiner, adjective or number attaches to its noun.",
  "A preposition attaches to the noun it introduces. That noun attaches to the word its phrase modifies (usually a verb or another noun), never to the preposition.",
  "A subordinating word (\"if\", \"because\", \"that\", infinitive \"to\") attaches to the verb of its own clause. That verb attaches to the word the clause modifies, never to the subordinating word.",
  "An auxiliary attaches to its main verb. When \"be\" links a subject to a noun or adjective, that noun or adjective is the head and \"be\" attaches to it.",
  "In a coordination like \"X, Y and Z\", Y and Z attach to X, and each comma or conjunction attaches to the conjunct after it.",
  "Other punctuation attaches to the head of the clause or phrase it ends or sets off.",
].join(" ");

export type HintVersion = "none" | "v1" | "v2";
export const UD_HEAD_HINTS: Record<Exclude<HintVersion, "none">, string> = { v1: UD_HEAD_HINTS_V1, v2: UD_HEAD_HINTS_V2 };

/** A short, distinguishing description of word `id` for use as an option. */
export function describeWord(words: string[], id: number): string {
  const w = words[id - 1] ?? "";
  const prev = words[id - 2];
  const next = words[id];
  let where = prev === undefined ? "the first word" : `after "${prev}"`;
  // Disambiguate repeated words that share a left neighbor.
  const clash = words.some((x, j) => j !== id - 1 && x === w && words[j - 1] === prev);
  if (clash) where += next === undefined ? ", the last word" : `, before "${next}"`;
  return `${wordRef(id)} ("${w}", ${where})`;
}

export interface HeadQuestionOptions {
  order: OptionOrder;
  hints: HintVersion;
  /** Candidate heads per dependent (word ids; 0 = root). Default: every other word plus root. */
  candidates?: (dep: number) => number[];
}

export function headQuestions(words: string[], opts: HeadQuestionOptions): Questions {
  const n = words.length;
  if (n + 1 > MAX_CHOICE_OPTIONS) {
    throw new Error(`sentence has ${n} words; a head Choice would exceed ${MAX_CHOICE_OPTIONS} options`);
  }
  const qs: Questions = {};
  for (let d = 1; d <= n; d++) {
    const cands = (opts.candidates?.(d) ?? range(0, n)).filter((h) => h !== d);
    if (cands.length < 2) continue; // only one possible head (a one-word sentence): nothing to ask
    const wordsFirst = cands.filter((h) => h !== 0).sort((a, b) => a - b);
    const hasRoot = cands.includes(0);
    const build = (ids: number[]): ChoiceQuestion => {
      const criteria: Record<string, Entry> = {};
      for (const h of ids) criteria[wordKey(h)] = describeWord(words, h);
      if (hasRoot) criteria[ROOT_OPTION] = `None: ${wordRef(d)} is the main word (predicate) of the whole sentence.`;
      const ref = wordRef(d);
      const instructions =
        `In \`sentence\`, which word is the head of ${ref}, the word that ${ref} attaches to as a modifier, argument or function word? ` +
        `Choose root only if ${ref} is the main predicate of the whole sentence.` +
        (opts.hints === "none" ? "" : ` ${UD_HEAD_HINTS[opts.hints]}`);
      return { type: "choice", instructions, criteria };
    };
    if (opts.order === "reversed") {
      qs[headId(d)] = build([...wordsFirst].reverse());
    } else {
      qs[headId(d)] = build(wordsFirst);
      if (opts.order === "both") qs[headRevId(d)] = build([...wordsFirst].reverse());
    }
  }
  return qs;
}

/** Option id ("w3" / "root") → word id (3 / 0). */
export function optionToHead(option: string): number {
  return option === ROOT_OPTION ? 0 : Number(option.slice(1));
}

// ---------------------------------------------------------------- relations

export const relGroupId = (dep: number) => `rel_w${dep}_group`;
export const relFineId = (dep: number, g: DeprelGroup) => `rel_w${dep}_${g}`;

/**
 * Hierarchical relation questions for one dependent: a coarse Choice over relation groups and one
 * fine Choice per group, all sent together (the fine answers for the wrong groups are ignored).
 * With `head` undefined the questions don't name the head (used by the single-request variant).
 */
export function relationQuestions(dep: number, head: number | undefined): Questions {
  const d = wordRef(dep);
  const lead =
    head === undefined
      ? `In \`sentence\`, consider ${d} and the word it depends on.`
      : `In \`sentence\`, ${d} depends on ${wordRef(head)}.`;
  const rel = head === undefined ? `to the word it depends on` : `to ${wordRef(head)}`;
  const qs: Questions = {
    [relGroupId(dep)]: {
      type: "choice",
      instructions: `${lead} What kind of dependent is ${d} ${rel}?`,
      criteria: { ...DEPREL_GROUP_DESCRIPTIONS },
    },
  };
  for (const [g, rels] of Object.entries(DEPREL_GROUPS) as [DeprelGroup, readonly string[]][]) {
    qs[relFineId(dep, g)] = {
      type: "choice",
      instructions: `${lead} Suppose ${d} is ${DEPREL_GROUP_LABELS[g]}. Which relation does ${d} have ${rel}?`,
      criteria: Object.fromEntries(rels.map((r) => [r, DEPREL_DESCRIPTIONS[r as keyof typeof DEPREL_DESCRIPTIONS]])),
    };
  }
  return qs;
}

export function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}
