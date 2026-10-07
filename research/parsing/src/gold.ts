// The treebank's answers for one sentence, in the shapes the question sets need. Used to score
// each Jev question in the eval's report card, and by the gold-tree oracle (a plumbing test).
//
// "Phrases" are not part of the treebank, so we derive them from its tree with one fixed rule,
// documented here so the phrase questions and their scoring agree:
//
//   A word joins the phrase of the word it attaches to when (1) the relationship is one that
//   stays inside a small phrase: determiner, adjective, number, compound, multiword name or
//   expression, preposition/case marker, auxiliary, copula, subordinator, coordinating word,
//   possessive, or "not"/a degree adverb; and (2) every word between them is already in
//   that phrase.
//
// So "the red ball", "across the yard", "has not seen" and "to leave" are phrases; a subject
// and its verb, or a verb and its object, are separate phrases.

import type { ConlluSentence } from "./ud/conllu.ts";
import { universalDeprel } from "./ud/deprel.ts";

export interface GoldWord {
  id: number;
  form: string;
  upos: string;
  head: number;
  /** Universal relation (subtype removed): "nmod:poss" → "nmod". */
  deprel: string;
  /** Full relation as written in the treebank. */
  fullDeprel: string;
}

export interface Gold {
  sentId: string;
  text: string;
  words: GoldWord[];
  /** phraseOf[id] = index of the gold phrase containing word id (index 0 unused). */
  phraseOf: number[];
  /** Gold phrases as lists of word ids, in sentence order. */
  phrases: number[][];
}

const INSIDE = new Set(["det", "amod", "nummod", "compound", "flat", "fixed", "case", "aux", "cop", "mark", "cc", "clf", "goeswith"]);

function staysInside(w: GoldWord, words: GoldWord[]): boolean {
  if (INSIDE.has(w.deprel)) return true;
  if (w.fullDeprel === "nmod:poss") return true;
  if (w.deprel === "advmod") {
    const head = words[w.head - 1];
    // "not"/"n't" on a verb, or a degree word on an adjective/adverb ("very large").
    return w.upos === "PART" || head?.upos === "ADJ" || head?.upos === "ADV";
  }
  return false;
}

export function goldOf(s: ConlluSentence): Gold {
  const words: GoldWord[] = s.words.map((w) => ({
    id: w.id,
    form: w.form,
    upos: w.upos,
    head: w.head,
    deprel: universalDeprel(w.deprel),
    fullDeprel: w.deprel,
  }));
  const n = words.length;
  // Union-find over word ids, merging closer pairs first so "between" words are settled.
  const parent = Array.from({ length: n + 1 }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x] as number)));
  for (let dist = 1; dist < n; dist++) {
    for (const w of words) {
      if (w.head === 0 || Math.abs(w.head - w.id) !== dist || !staysInside(w, words)) continue;
      const root = find(w.head);
      const lo = Math.min(w.id, w.head);
      const hi = Math.max(w.id, w.head);
      let ok = true;
      for (let k = lo + 1; k < hi; k++) if (find(k) !== root) ok = false;
      if (ok) parent[find(w.id)] = root;
    }
  }
  const phrases: number[][] = [];
  const phraseOf = new Array<number>(n + 1).fill(-1);
  const index = new Map<number, number>();
  for (let id = 1; id <= n; id++) {
    const r = find(id);
    if (!index.has(r)) {
      index.set(r, phrases.length);
      phrases.push([]);
    }
    const p = index.get(r) as number;
    phrases[p]!.push(id);
    phraseOf[id] = p;
  }
  return { sentId: s.sentId, text: s.text, words, phraseOf, phrases };
}

export function goldHead(g: Gold, id: number): number {
  return g.words[id - 1]?.head ?? -1;
}

/** Distance of each word from the root (root word = 1). */
export function depthOf(g: Gold, id: number): number {
  let d = 0;
  for (let k = id; k > 0 && d <= g.words.length; k = goldHead(g, k)) d++;
  return d;
}
