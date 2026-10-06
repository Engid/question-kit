// Code-only parsing rules: no Jev. Used three ways:
//   rung 0 (rules):                  tag words with a small lexicon, then attach by rules
//   rung 1 (rules-with-jev-types):   the same attachment rules, using Jev's word types
//   rung 2 (code-proposes-jev-picks): the rules propose a few candidate heads; Jev picks
//
// Deliberately simple: a floor to measure Jev against, not a competitor.

import { decodeSingleRoot, NEG } from "../decode/cle.ts";

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean));

const LEX: [string, Set<string>][] = [
  ["DET", words("a an the this these those some any no every each all both either neither another what which whose")],
  ["PRON", words("i you he she it we they me him us them myself yourself himself herself itself ourselves themselves mine yours hers ours theirs who whom something anything nothing everything someone anyone everyone nobody my your his her its our their")],
  ["ADP", words("of in on at by for with from into onto about over under after before between through during without within among against around near across behind beyond like than per via upon")],
  ["AUX", words("is am are was were be been being do does did have has had will would can could shall should may might must ca wo 're 'm 'll 'd 've")],
  ["CCONJ", words("and or but nor &")],
  ["SCONJ", words("if because although though while whether unless whereas")],
  ["PART", words("not n't")],
  ["INTJ", words("uh um oh yes yeah hi hello please ok okay wow hmm")],
  ["NUM", words("one two three four five six seven eight nine ten eleven twelve twenty thirty hundred thousand million")],
];
const lexicon = (tag: string) => LEX.find(([t]) => t === tag)?.[1] ?? new Set<string>();
const POSSESSIVE = words("my your his her its our their");
const SUBJECT_PRONOUNS = words("i you he she we they");
const COMMON_ADJ = words("good new large small big great other hot cold little old long high different important same few last own early young sure able happy bad best better free full real nice");
const NOMINAL = new Set(["NOUN", "PROPN", "PRON", "NUM"]);

export function ruleTag(forms: string[]): string[] {
  const tags: string[] = [];
  forms.forEach((form, i) => {
    const w = form.toLowerCase();
    const prev = tags[i - 1];
    const prevForm = forms[i - 1]?.toLowerCase();
    let tag: string | undefined;
    if (/^\p{P}+$/u.test(form)) tag = "PUNCT";
    else if (/^[$%+=@#]+$/.test(form)) tag = "SYM";
    else if (/^\d+([.,:]\d+)*$/.test(form)) tag = "NUM";
    else if (w === "to") {
      // Infinitive "to" before a lowercase word that isn't a determiner or pronoun; otherwise a preposition.
      const nx = forms[i + 1]?.toLowerCase() ?? "";
      tag = /^[a-z]+$/.test(nx) && !lexicon("DET").has(nx) && !lexicon("PRON").has(nx) ? "PART" : "ADP";
    }
    else if (w === "'s" || w === "’s") tag = prev && NOMINAL.has(prev) ? "PART" : "AUX";
    else if (w === "that") tag = prev === "VERB" ? "SCONJ" : "DET";
    else {
      for (const [t, set] of LEX) if (set.has(w)) { tag = t; break; }
    }
    if (!tag) {
      if (prevForm === "to" || prev === "AUX" || (prevForm && SUBJECT_PRONOUNS.has(prevForm))) tag = "VERB";
      else if (/ly$/.test(w) && w.length > 4) tag = "ADV";
      else if (/(ing|ed)$/.test(w) && w.length > 4) tag = "VERB";
      else if (COMMON_ADJ.has(w) || /(ous|ful|able|ible|ive|ic|less|ish)$/.test(w)) tag = "ADJ";
      else if (i > 0 && /^\p{Lu}/u.test(form)) tag = "PROPN";
      else tag = "NOUN";
    }
    tags.push(tag);
  });
  return tags;
}

/** Index of the nearest word in [from, to) (stepping by `dir`) whose tag passes `ok`, stopping at `stop`. */
function seek(tags: string[], from: number, dir: 1 | -1, ok: (t: string) => boolean, stop: (t: string) => boolean = () => false): number {
  for (let i = from; i >= 0 && i < tags.length; i += dir) {
    const t = tags[i] as string;
    if (ok(t)) return i;
    if (stop(t)) return -1;
  }
  return -1;
}

export function ruleParse(forms: string[], tags: string[]): { heads: number[]; deprels: string[] } {
  const n = forms.length;
  const isNoun = (t: string) => t === "NOUN" || t === "PROPN";
  const isVerb = (t: string) => t === "VERB";
  const clauseBreak = (t: string) => t === "PUNCT" || t === "VERB" || t === "CCONJ";
  let pred = tags.findIndex(isVerb);
  if (pred < 0) pred = tags.findIndex((t) => t === "ADJ");
  if (pred < 0) pred = tags.findIndex(isNoun);
  if (pred < 0) pred = tags.findIndex((t) => t !== "PUNCT");
  if (pred < 0) pred = 0;

  const heads = new Array<number>(n).fill(pred + 1); // 1-based heads; 0 = root
  const rels = new Array<string>(n).fill("dep");
  for (let i = 0; i < n; i++) {
    const t = tags[i] as string;
    const w = (forms[i] as string).toLowerCase();
    if (i === pred) { heads[i] = 0; rels[i] = "root"; continue; }
    let h = -1;
    let rel = "dep";
    switch (t) {
      case "PUNCT": h = pred; rel = "punct"; break;
      case "DET": case "NUM": case "ADJ":
        h = seek(tags, i + 1, 1, isNoun, clauseBreak);
        rel = t === "DET" ? "det" : t === "NUM" ? "nummod" : "amod";
        if (h < 0 && t === "ADJ") { h = pred; rel = "xcomp"; }
        break;
      case "PRON":
        if (POSSESSIVE.has(w)) { h = seek(tags, i + 1, 1, isNoun, clauseBreak); rel = "nmod"; }
        if (h < 0) { h = i < pred ? pred : seek(tags, i - 1, -1, isVerb); rel = i < pred ? "nsubj" : "obj"; }
        break;
      case "ADP": h = seek(tags, i + 1, 1, (x) => NOMINAL.has(x), (x) => x === "PUNCT" || x === "VERB"); rel = "case"; break;
      case "AUX": h = seek(tags, i + 1, 1, (x) => isVerb(x) || x === "ADJ" || isNoun(x), (x) => x === "PUNCT"); rel = h >= 0 && tags[h] !== "VERB" ? "cop" : "aux"; break;
      case "PART":
        if (w === "'s" || w === "’s") { h = i - 1; rel = "case"; }
        else { h = seek(tags, i + 1, 1, isVerb, (x) => x === "PUNCT"); rel = w === "to" ? "mark" : "advmod"; }
        break;
      case "SCONJ": h = seek(tags, i + 1, 1, isVerb, (x) => x === "PUNCT"); rel = "mark"; break;
      case "CCONJ": h = seek(tags, i + 1, 1, (x) => isNoun(x) || isVerb(x) || x === "ADJ" || x === "PRON"); rel = "cc"; break;
      case "ADV": h = seek(tags, i + 1, 1, (x) => isVerb(x) || x === "ADJ", (x) => x === "PUNCT"); if (h < 0) h = pred; rel = "advmod"; break;
      case "INTJ": h = pred; rel = "discourse"; break;
      case "NOUN": case "PROPN": {
        const next = tags[i + 1];
        if (next && isNoun(next) && tags[i] === next) { h = i + 1; rel = t === "PROPN" ? "flat" : "compound"; break; }
        const caseBefore = seek(tags, i - 1, -1, (x) => x === "ADP", (x) => x === "PUNCT" || x === "VERB" || isNoun(x));
        if (caseBefore >= 0) {
          const v = seek(tags, caseBefore - 1, -1, (x) => isVerb(x) || isNoun(x));
          h = v >= 0 ? v : pred;
          rel = h >= 0 && isNoun(tags[h] as string) ? "nmod" : "obl";
          break;
        }
        const cc = seek(tags, i - 1, -1, (x) => x === "CCONJ", (x) => x === "PUNCT" || x === "VERB" || isNoun(x));
        if (cc >= 0) {
          const first = seek(tags, cc - 1, -1, isNoun, (x) => x === "VERB");
          if (first >= 0) { h = first; rel = "conj"; break; }
        }
        h = i < pred ? pred : seek(tags, i - 1, -1, isVerb);
        rel = i < pred ? "nsubj" : "obj";
        break;
      }
      case "VERB": {
        const mark = i > 0 && (tags[i - 1] === "PART" || tags[i - 1] === "SCONJ");
        h = seek(tags, i - 1, -1, isVerb);
        rel = mark ? (tags[i - 1] === "PART" ? "xcomp" : "advcl") : "conj";
        if (h < 0) h = pred;
        break;
      }
      default: h = pred;
    }
    if (h < 0 || h === i) h = pred === i ? -1 : pred;
    heads[i] = h + 1;
    rels[i] = rel;
  }

  // Repair cycles or stray roots with the MST decoder: the rule head scores 0, everything else
  // a small penalty that grows with distance.
  const scores: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(n + 1).fill(NEG));
  for (let d = 1; d <= n; d++) {
    for (let h = 0; h <= n; h++) {
      if (h === d) continue;
      const row = scores[h] as number[];
      row[d] = heads[d - 1] === h ? 0 : -5 - 0.01 * Math.abs(h === 0 ? d : h - d);
    }
  }
  const decoded = decodeSingleRoot(scores).heads.slice(1);
  const deprels = decoded.map((h, i) => (h === 0 ? "root" : h === heads[i] ? (rels[i] as string) : "dep"));
  return { heads: decoded, deprels };
}

/**
 * A short list of plausible heads for each word, for Jev to choose from (rung 2): the rules' own
 * pick, both neighbors, the nearest two content words and the nearest noun and verb on each side,
 * and root. With the treebank's own word types this list contains the right head for 91% of words
 * on EWT dev, at about 6 candidates per word (vs ~20 for "every other word").
 * tags/ruleHeads are 0-based (word i + 1); returns word ids (0 = root).
 */
export function proposeCandidates(tags: string[], ruleHeads: number[]): number[][] {
  const n = tags.length;
  const content = (t: string) => ["NOUN", "PROPN", "VERB", "ADJ", "PRON", "NUM"].includes(t);
  const nearest = (from: number, dir: 1 | -1, ok: (t: string) => boolean) => {
    for (let i = from + dir; i >= 0 && i < n; i += dir) if (ok(tags[i] as string)) return i;
    return -1;
  };
  return tags.map((_, i) => {
    const d = i + 1;
    const c = new Set<number>([ruleHeads[i] as number, 0, d - 1, d + 1]);
    for (const dir of [-1, 1] as const) {
      const first = nearest(i, dir, content);
      c.add(first + 1);
      if (first >= 0) c.add(nearest(first, dir, content) + 1);
      c.add(nearest(i, dir, (t) => t === "NOUN" || t === "PROPN") + 1);
      c.add(nearest(i, dir, (t) => t === "VERB") + 1);
    }
    return [...c].filter((h) => h >= 0 && h <= n && h !== d).sort((a, b) => a - b);
  });
}
