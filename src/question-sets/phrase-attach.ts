// Question set: PHRASES — two kinds of question, asked together in the call after the phrases
// are known (they're built from the neighbor-link answers):
//
//   inside   "Inside this phrase, which word does this word attach to?"
//            One small Choice per word in a phrase of 2+ words: the other words of the phrase, or
//            "a word outside the phrase" (meaning this word is the phrase's main word).
//   between  "Which phrase does this phrase attach to?"
//            One Choice per phrase, over the other phrases plus root.
//
// The state gains a `phrases` field: { "p1": "The dog", "p2": "chased", ... }, and the questions
// point at phrases with paths like `phrases.p2`.
//
// Combining the answers into a vote for each word:
//   P(word → w inside its phrase)       = inside answer for w
//   P(word → main word of phrase Q)     = inside answer for "outside" × between answer for Q
//   P(word → root)                      = inside answer for "outside" × between answer for root
// where a phrase's main word is the word most likely to attach outside it.

import { type Answers, choiceOf, type QuestionBatch, type QuestionMeta } from "../calls.ts";
import { depthOf, type Gold } from "../gold.ts";
import type { Json } from "../jev/types.ts";
import { describeWord, type Sentence, wordKey, wordRef } from "../sentence.ts";
import type { HeadDist } from "../votes.ts";
import { type Hints, hintText } from "./attach-to.ts";

export const ID_INSIDE = "inside-phrase";
export const TITLE_INSIDE = "Inside this phrase, which word does this word attach to?";
export const ID_BETWEEN = "between-phrases";
export const TITLE_BETWEEN = "Which phrase does this phrase attach to?";

const OUTSIDE = "outside";
const ROOT = "root";
const phraseKey = (k: number) => `p${k + 1}`;
const phraseRef = (k: number) => `\`phrases.p${k + 1}\``;

export function phraseText(s: Sentence, phrase: number[]): string {
  return phrase.map((id) => s.words[id - 1]).join(" ");
}

/** Extra state for this call: the phrase texts. */
export function phraseState(s: Sentence, phrases: number[][]): Record<string, Json> {
  return { phrases: Object.fromEntries(phrases.map((p, k) => [phraseKey(k), phraseText(s, p)])) };
}

export function ask(s: Sentence, phrases: number[][], hints: Hints = "v1"): QuestionBatch {
  const batch: QuestionBatch = {};
  phrases.forEach((phrase, k) => {
    if (phrase.length < 2) return;
    for (const d of phrase) {
      const criteria: Record<string, string> = {};
      const options: Record<string, number | string> = {};
      for (const w of phrase) {
        if (w === d) continue;
        criteria[wordKey(w)] = describeWord(s.words, w);
        options[wordKey(w)] = w;
      }
      criteria[OUTSIDE] = `A word outside ${phraseRef(k)}: ${wordRef(d)} is the main word of the phrase.`;
      options[OUTSIDE] = OUTSIDE;
      batch[`in_w${d}`] = {
        question: {
          type: "choice",
          instructions: `In \`sentence\`, ${wordRef(d)} is part of the phrase ${phraseRef(k)}. Which word does ${wordRef(d)} attach to?${hintText(hints)}`,
          criteria,
        },
        meta: { set: ID_INSIDE, word: d, phrase, options },
      };
    }
  });
  if (phrases.length > 1) {
    phrases.forEach((phrase, k) => {
      const criteria: Record<string, string> = {};
      const options: Record<string, number[] | number> = {};
      phrases.forEach((other, j) => {
        if (j === k) return;
        criteria[phraseKey(j)] = `${phraseRef(j)} ("${phraseText(s, other)}")`;
        options[phraseKey(j)] = other;
      });
      criteria[ROOT] = `None: ${phraseRef(k)} contains the main word (predicate) of the whole sentence.`;
      options[ROOT] = 0;
      batch[`pa_p${k + 1}`] = {
        question: {
          type: "choice",
          instructions:
            `In \`sentence\`, which phrase does ${phraseRef(k)} attach to? Pick the phrase that contains the word ` +
            `that the main word of ${phraseRef(k)} modifies, completes or serves.${hintText(hints)}`,
          criteria,
        },
        meta: { set: ID_BETWEEN, phrase, options },
      };
    });
  }
  return batch;
}

export interface PhraseReading {
  /** Main word of each phrase (the word most likely to attach outside it). */
  mainWords: number[];
  /** Votes per word. */
  votes: Map<number, HeadDist>;
}

export function read(s: Sentence, phrases: number[][], answers: Answers): PhraseReading {
  // Inside answers: for each word, P(attach to w) for w in its phrase, and P(outside).
  const inside = new Map<number, Record<string, number>>();
  for (const phrase of phrases) {
    for (const d of phrase) {
      inside.set(d, phrase.length < 2 ? { [OUTSIDE]: 1 } : choiceOf(answers, `in_w${d}`).probabilities);
    }
  }
  const mainWords = phrases.map((phrase) => {
    let best = phrase[0] as number;
    for (const d of phrase) if ((inside.get(d)?.[OUTSIDE] ?? 0) > (inside.get(best)?.[OUTSIDE] ?? 0)) best = d;
    return best;
  });
  const votes = new Map<number, HeadDist>();
  phrases.forEach((phrase, k) => {
    const between: Record<string, number> = phrases.length > 1 ? choiceOf(answers, `pa_p${k + 1}`).probabilities : { [ROOT]: 1 };
    for (const d of phrase) {
      const ins = inside.get(d) ?? {};
      const out = ins[OUTSIDE] ?? 0;
      const dist: HeadDist = {};
      for (const [opt, p] of Object.entries(ins)) if (opt !== OUTSIDE) dist[Number(opt.slice(1))] = p;
      for (const [opt, p] of Object.entries(between)) {
        const head = opt === ROOT ? 0 : (mainWords[Number(opt.slice(1)) - 1] as number);
        if (head !== d) dist[head] = (dist[head] ?? 0) + out * p;
      }
      votes.set(d, dist);
    }
  });
  return { mainWords, votes };
}

export function expectedInside(meta: QuestionMeta, gold: Gold): string | undefined {
  const head = gold.words[(meta.word ?? 0) - 1]?.head;
  if (head === undefined) return undefined;
  const inPhrase = Object.entries(meta.options ?? {}).find(([, w]) => w === head)?.[0];
  return inPhrase ?? OUTSIDE;
}

export function expectedBetween(meta: QuestionMeta, gold: Gold): string | undefined {
  const phrase = meta.phrase ?? [];
  // The phrase's main word per the treebank: of the words whose head is outside the phrase, the
  // one closest to the root.
  const leaving = phrase.filter((d) => !phrase.includes(gold.words[d - 1]?.head ?? -1));
  if (leaving.length === 0) return undefined;
  const main = leaving.reduce((a, b) => (depthOf(gold, b) < depthOf(gold, a) ? b : a));
  const head = gold.words[main - 1]?.head ?? -1;
  if (head === 0) return ROOT;
  return Object.entries(meta.options ?? {}).find(([, ws]) => Array.isArray(ws) && ws.includes(head))?.[0];
}
