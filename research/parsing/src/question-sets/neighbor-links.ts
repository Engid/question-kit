// Question set: NEIGHBOR LINKS — "Are these two neighboring words in the same small phrase?"
//
// One yes/no (Noul) per pair of neighbors. Tiny questions, aimed at what Jev does well: in the
// first 125-sentence run, Jev's attachment answers were right 87% of the time when the right
// answer was a neighboring word. The yes/no answers cut the sentence into phrases, which the
// phrase questions (phrase-attach.ts) then work with.
//
// The definition of "small phrase" in the question matches the one used to score it (src/gold.ts).

import { type Answers, noulOf, type QuestionBatch } from "../../../lab/calls.ts";
import type { Gold } from "../gold.ts";
import type { QuestionMeta } from "../../../lab/calls.ts";
import { type Sentence, wordRef } from "../sentence.ts";

export const ID = "neighbor-links";
export const TITLE = "Are these two neighboring words in the same small phrase?";

export const PHRASE_DEFINITION =
  "A small phrase is a word together with the little words and modifiers that hang on it: a noun with its determiner, " +
  "possessive, numbers and adjectives (\"my two very large boxes\"), a preposition with the noun it introduces (\"across the yard\"), " +
  "a verb with its helpers and \"not\" (\"has not seen\"), \"to\" or \"that\" with its verb (\"to leave\"), a conjunction with " +
  "the word after it (\"and cats\"), and multiword names (\"New York\"). A subject and its verb, a verb and its object, and two " +
  "different clauses are separate phrases. A punctuation mark is a phrase of its own.";

export function ask(s: Sentence): QuestionBatch {
  const batch: QuestionBatch = {};
  for (let a = 1; a < s.words.length; a++) {
    const b = a + 1;
    batch[`link_w${a}_w${b}`] = {
      question: {
        type: "noul",
        instructions: `In \`sentence\`, are ${wordRef(a)} and ${wordRef(b)} part of the same small phrase? ${PHRASE_DEFINITION}`,
        criteria: {
          true: `Yes: ${wordRef(a)} and ${wordRef(b)} are in the same small phrase.`,
          false: `No: a phrase boundary falls between ${wordRef(a)} and ${wordRef(b)}.`,
        },
      },
      meta: { set: ID, pair: [a, b] },
    };
  }
  return batch;
}

/** linkP[a] = probability that words a and a+1 are in the same phrase (index 0 unused). */
export function read(s: Sentence, answers: Answers): number[] {
  const out = [0];
  for (let a = 1; a < s.words.length; a++) out.push(noulOf(answers, `link_w${a}_w${a + 1}`));
  return out;
}

/** Cut the sentence wherever the link probability is below `threshold`. */
export function phrasesFrom(n: number, linkP: number[], threshold = 0.5): number[][] {
  const phrases: number[][] = [];
  let cur: number[] = [];
  for (let id = 1; id <= n; id++) {
    cur.push(id);
    if (id === n || (linkP[id] ?? 0) < threshold) {
      phrases.push(cur);
      cur = [];
    }
  }
  return phrases;
}

export function expected(meta: QuestionMeta, gold: Gold): boolean | undefined {
  const [a, b] = meta.pair ?? [0, 0];
  if (!a || !b) return undefined;
  return gold.phraseOf[a] === gold.phraseOf[b];
}
