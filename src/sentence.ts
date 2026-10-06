// The sentence as Jev sees it. Every request sends the same kind of state:
//
//   { "sentence": "The dog chased a red ball.",
//     "words": { "w1": "The", "w2": "dog", "w3": "chased", ... } }
//
// and every question points into it with a backticked path, like `words.w3`. That's how TypeSafe's
// docs recommend referring to parts of the state: https://docs.typesafe.ai/primitives.md

import type { Entry, Json } from "./jev/types.ts";
import { tokenize } from "./tokenize.ts";

export interface Sentence {
  /** Words 1..n are words[0..n-1]. Word ids start at 1; 0 means "the root" (no head). */
  words: string[];
  text: string;
}

/** Raw text (split by our tokenizer), or words that are already split (the treebank's, in evals). */
export type ParseInput = string | { words: string[]; text?: string };

export function sentenceOf(input: ParseInput): Sentence {
  if (typeof input === "string") return { words: tokenize(input).map((t) => t.form), text: input.trim() };
  return { words: input.words, text: input.text ?? input.words.join(" ") };
}

export const wordKey = (id: number) => `w${id}`;
/** How a question refers to a word: `words.w3`. */
export const wordRef = (id: number) => `\`words.w${id}\``;

export type WordsInState =
  /** Each word is a plain string under `words.wN` (the default). */
  | "plain"
  /** Each word also carries its left and right neighbor. */
  | "with-neighbors";

/** The state for a request. `extra` adds more top-level fields (e.g. the phrases found so far). */
export function stateOf(s: Sentence, extra: Record<string, Json> = {}, words: WordsInState = "plain"): Entry {
  const ws: Record<string, Json> = {};
  s.words.forEach((w, i) => {
    ws[wordKey(i + 1)] = words === "plain" ? w : { word: w, before: s.words[i - 1] ?? null, after: s.words[i + 1] ?? null };
  });
  return { sentence: s.text, words: ws, ...extra };
}

/**
 * A short description of a word for use as an option, so that repeated words can be told apart:
 * `words.w6` ("ball", after "red").
 */
export function describeWord(words: string[], id: number): string {
  const w = words[id - 1] ?? "";
  const prev = words[id - 2];
  const next = words[id];
  let where = prev === undefined ? "the first word" : `after "${prev}"`;
  const clash = words.some((x, j) => j !== id - 1 && x === w && words[j - 1] === prev);
  if (clash) where += next === undefined ? ", the last word" : `, before "${next}"`;
  return `${wordRef(id)} ("${w}", ${where})`;
}

export function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}
