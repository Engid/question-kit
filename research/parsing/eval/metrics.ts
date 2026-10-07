// Scoring against the treebank.
//
// Strategy scores follow the CoNLL 2018 shared task conventions: every word counts (punctuation
// included), and relationships are compared on their universal part only (`nmod:poss` → `nmod`).
// https://universaldependencies.org/conll18/evaluation.html  Evals use the treebank's own words, so
// no alignment step is needed.
//
//   attached right   (UAS)  the word's head matches the treebank
//   right pair              the treebank links these two words, in either direction
//   + relationship   (LAS)  attached right, and the relationship name matches too
//
// Question-set scores check each Jev answer against what the treebank says the right option is.

import type { CallRecord, QuestionMeta } from "../../lab/calls.ts";
import type { Gold } from "../src/gold.ts";
import type { ChoiceAnswer, NoulAnswer } from "../../lab/jev/types.ts";
import { QUESTION_SETS } from "../src/question-sets/index.ts";
import type { ParseResult } from "../src/types.ts";
import type { ConlluSentence } from "../src/ud/conllu.ts";
import { deprelGroupOf, universalDeprel } from "../src/ud/deprel.ts";
import { type Upos, uposGroupOf } from "../src/ud/upos.ts";
import { bucketOf } from "./data.ts";

export interface EdgeObs {
  word: number;
  goldHead: number;
  head: number;
  argmax: number;
  /** False when code decided (rules); calibration uses Jev-judged edges only. */
  judged: boolean;
  p: number;
  separation: number;
  headCorrect: boolean;
  labelCorrect: boolean;
  argmaxCorrect: boolean;
  goldDeprel: string;
}

export interface SentenceScore {
  sentId: string;
  n: number;
  bucket: string;
  upos: number;
  uas: number;
  las: number;
  /** Treebank links (non-root words) found in either direction. */
  pairs: number;
  links: number;
  edges: EdgeObs[];
  requests: number;
  questions: number;
  jevMs: number;
  inputTokens: number;
  outputTokens: number;
  requestChars: number;
  argmaxDisagreements: number;
  argmaxMutualPairs: number;
}

/** Per-word predictions, from a ParseResult or from a CoNLL-U file. */
export interface Prediction {
  upos: string[];
  heads: number[];
  deprels: string[];
  p?: number[];
  separation?: number[];
  argmaxHeads?: number[];
  judged?: boolean[];
}

export function predictionOf(r: ParseResult): Prediction {
  return {
    upos: r.tokens.map((t) => t.upos),
    heads: r.edges.map((e) => e.head),
    deprels: r.edges.map((e) => e.deprel),
    p: r.edges.map((e) => e.p),
    separation: r.edges.map((e) => e.separation),
    argmaxHeads: r.edges.map((e) => e.argmaxHead),
    judged: r.edges.map((e) => Object.keys(e.headDist).length > 0),
  };
}

export function scoreSentence(gold: ConlluSentence, pred: Prediction, stats?: ParseResult["stats"]): SentenceScore {
  const n = gold.words.length;
  if (pred.heads.length !== n) throw new Error(`${gold.sentId}: ${pred.heads.length} predicted words vs ${n} gold`);
  const predPairs = new Set(pred.heads.map((h, i) => (h > 0 ? pairKey(i + 1, h) : "")));
  let upos = 0;
  let uas = 0;
  let las = 0;
  let pairs = 0;
  let links = 0;
  const edges: EdgeObs[] = [];
  gold.words.forEach((g, i) => {
    const head = pred.heads[i] as number;
    const headOk = head === g.head;
    const labelOk = headOk && universalDeprel(pred.deprels[i] ?? "") === universalDeprel(g.deprel);
    if (pred.upos[i] === g.upos) upos++;
    if (headOk) uas++;
    if (labelOk) las++;
    if (g.head > 0) {
      links++;
      if (predPairs.has(pairKey(g.id, g.head))) pairs++;
    }
    edges.push({
      word: g.id,
      goldHead: g.head,
      head,
      argmax: pred.argmaxHeads?.[i] ?? head,
      judged: pred.judged?.[i] ?? false,
      p: pred.p?.[i] ?? 1,
      separation: pred.separation?.[i] ?? Infinity,
      headCorrect: headOk,
      labelCorrect: labelOk,
      argmaxCorrect: (pred.argmaxHeads?.[i] ?? head) === g.head,
      goldDeprel: universalDeprel(g.deprel),
    });
  });
  return {
    sentId: gold.sentId,
    n,
    bucket: bucketOf(n),
    upos,
    uas,
    las,
    pairs,
    links,
    edges,
    requests: stats?.requests ?? 0,
    questions: stats?.questions ?? 0,
    jevMs: stats?.jevMs ?? 0,
    inputTokens: stats?.inputTokens ?? 0,
    outputTokens: stats?.outputTokens ?? 0,
    requestChars: stats?.requestChars ?? 0,
    argmaxDisagreements: stats?.argmaxDisagreements ?? 0,
    argmaxMutualPairs: stats?.argmaxMutualPairs ?? 0,
  };
}

const pairKey = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;

export interface Aggregate {
  sentences: number;
  words: number;
  upos: number;
  uas: number;
  las: number;
  /** Treebank links found, ignoring direction. */
  pairs: number;
  /** Attached right if each word took Jev's top answer (before the tree builder and cleanup). */
  argmaxUas: number;
  requestsPerSentence: number;
  questionsPerSentence: number;
  jevMsPerSentence: number;
  inputTokensPerSentence: number;
  outputTokensPerSentence: number;
  requestCharsPerSentence: number;
  /** Share of words whose final head differs from Jev's top answer. */
  argmaxDisagreementRate: number;
  /** Pairs of words whose top answers point at each other, per 100 words. */
  mutualPairsPer100Words: number;
}

export function aggregate(scores: SentenceScore[]): Aggregate {
  const words = scores.reduce((a, s) => a + s.n, 0);
  const sum = (f: (s: SentenceScore) => number) => scores.reduce((a, s) => a + f(s), 0);
  const per = (f: (s: SentenceScore) => number) => (scores.length ? sum(f) / scores.length : 0);
  const edges = scores.flatMap((s) => s.edges);
  const links = sum((s) => s.links);
  return {
    sentences: scores.length,
    words,
    upos: words ? sum((s) => s.upos) / words : 0,
    uas: words ? sum((s) => s.uas) / words : 0,
    las: words ? sum((s) => s.las) / words : 0,
    pairs: links ? sum((s) => s.pairs) / links : 0,
    argmaxUas: words ? edges.filter((e) => e.argmaxCorrect).length / words : 0,
    requestsPerSentence: per((s) => s.requests),
    questionsPerSentence: per((s) => s.questions),
    jevMsPerSentence: per((s) => s.jevMs),
    inputTokensPerSentence: per((s) => s.inputTokens),
    outputTokensPerSentence: per((s) => s.outputTokens),
    requestCharsPerSentence: per((s) => s.requestChars),
    argmaxDisagreementRate: words ? sum((s) => s.argmaxDisagreements) / words : 0,
    mutualPairsPer100Words: words ? (100 * sum((s) => s.argmaxMutualPairs)) / words : 0,
  };
}

// ------------------------------------------------------------------ question sets

/** One Jev answer checked against the treebank. */
export interface AnswerCheck {
  /** Report row: the question set, split by level for two-level sets. */
  row: string;
  /** Whether the treebank's answer was among the options (or applies at all). */
  hasRightAnswer: boolean;
  correct: boolean;
  /** Jev's probability for its top answer (for a yes/no: max(p, 1 − p)). */
  topP: number;
  options: number;
}

export function rowOf(meta: QuestionMeta): string {
  if (meta.set === "word-type") return meta.level === "type" ? "word-type" : meta.level === "group" ? "word-type (group)" : "word-type (within group)";
  if (meta.set === "relationship") return meta.level === "kind" ? "relationship (kind)" : "relationship (specific)";
  return meta.set;
}

export function checkAnswers(calls: CallRecord[], gold: Gold): AnswerCheck[] {
  const out: AnswerCheck[] = [];
  for (const call of calls) {
    for (const [id, q] of Object.entries(call.request.questions)) {
      const meta = call.meta[id];
      const answer = call.response.answers[id];
      const set = meta ? QUESTION_SETS[meta.set] : undefined;
      if (!meta || !answer || !set) continue;
      if (underWrongFirstLevel(meta, gold)) continue;
      const right = set.expected(meta, gold);
      if (q.type === "noul") {
        const p = (answer as NoulAnswer).noul;
        out.push({ row: rowOf(meta), hasRightAnswer: right !== undefined, correct: right !== undefined && p >= 0.5 === right, topP: Math.max(p, 1 - p), options: 2 });
      } else if (q.type === "choice") {
        const probs = (answer as ChoiceAnswer).probabilities;
        const top = Object.entries(probs).sort((a, b) => b[1] - a[1])[0];
        out.push({
          row: rowOf(meta),
          hasRightAnswer: right !== undefined,
          correct: right !== undefined && top?.[0] === right,
          topP: top?.[1] ?? 0,
          options: Object.keys(q.criteria).length,
        });
      }
    }
  }
  return out;
}

/**
 * Two-level questions ask a second-level question under every first-level option; only the one
 * under the treebank's first-level answer can be right, so the others aren't scored at all.
 */
function underWrongFirstLevel(meta: QuestionMeta, gold: Gold): boolean {
  const g = gold.words[(meta.word ?? 0) - 1];
  if (!g) return false;
  if (meta.set === "word-type" && meta.level !== "type" && meta.level !== "group") return meta.level !== uposGroupOf(g.upos as Upos);
  if (meta.set === "relationship" && meta.level !== "kind") return meta.level !== deprelGroupOf(g.deprel);
  return false;
}

export interface QuestionSetRow {
  row: string;
  questions: number;
  meanOptions: number;
  /** Share of questions whose right answer was among the options. */
  offered: number;
  /** Of those, how often Jev's top answer was right. */
  right: number;
  /** Share of questions where Jev was at least 90% sure. */
  sure: number;
  /** How often Jev was right when at least 90% sure. */
  rightWhenSure: number;
}

const ROW_ORDER = [
  "word-type", "word-type (group)", "word-type (within group)", "neighbor-links", "direction", "attach-to",
  "inside-phrase", "between-phrases", "second-look", "relationship (kind)", "relationship (specific)",
];

export function questionSetRows(checks: AnswerCheck[]): QuestionSetRow[] {
  const rows = new Map<string, AnswerCheck[]>();
  for (const c of checks) rows.set(c.row, [...(rows.get(c.row) ?? []), c]);
  const rank = (r: string) => (ROW_ORDER.indexOf(r) < 0 ? ROW_ORDER.length : ROW_ORDER.indexOf(r));
  return [...rows.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([row, cs]) => {
    const scorable = cs.filter((c) => c.hasRightAnswer);
    const sure = scorable.filter((c) => c.topP >= 0.9);
    return {
      row,
      questions: cs.length,
      meanOptions: cs.reduce((a, c) => a + c.options, 0) / cs.length,
      offered: scorable.length / cs.length,
      right: scorable.length ? scorable.filter((c) => c.correct).length / scorable.length : 0,
      sure: scorable.length ? sure.length / scorable.length : 0,
      rightWhenSure: sure.length ? sure.filter((c) => c.correct).length / sure.length : 0,
    };
  });
}

// ------------------------------------------------------------------ detail

export interface ReliabilityBin {
  lo: number;
  hi: number;
  count: number;
  meanP: number;
  accuracy: number;
}

export interface Calibration {
  bins: ReliabilityBin[];
  /** Expected calibration error of p (the chosen head's probability) against head correctness. */
  ece: number;
  /** For each separation threshold: how well "separation below t" flags wrong heads. */
  flags: { threshold: number; flagged: number; precision: number; recall: number; accuracyAbove: number }[];
}

export function calibration(edges: EdgeObs[], nBins = 10, thresholds = [1.5, 2, 4]): Calibration {
  const usable = edges.filter((e) => e.judged);
  const bins: ReliabilityBin[] = [];
  for (let b = 0; b < nBins; b++) {
    const lo = b / nBins;
    const hi = (b + 1) / nBins;
    const inBin = usable.filter((e) => (b === nBins - 1 ? e.p >= lo && e.p <= hi : e.p >= lo && e.p < hi));
    bins.push({
      lo,
      hi,
      count: inBin.length,
      meanP: inBin.length ? inBin.reduce((a, e) => a + e.p, 0) / inBin.length : 0,
      accuracy: inBin.length ? inBin.filter((e) => e.headCorrect).length / inBin.length : 0,
    });
  }
  const total = usable.length;
  const ece = total ? bins.reduce((a, b) => a + (b.count / total) * Math.abs(b.accuracy - b.meanP), 0) : 0;
  const wrong = usable.filter((e) => !e.headCorrect).length;
  const flags = thresholds.map((t) => {
    const flagged = usable.filter((e) => e.separation < t);
    const above = usable.filter((e) => e.separation >= t);
    const flaggedWrong = flagged.filter((e) => !e.headCorrect).length;
    return {
      threshold: t,
      flagged: flagged.length,
      precision: flagged.length ? flaggedWrong / flagged.length : 0,
      recall: wrong ? flaggedWrong / wrong : 0,
      accuracyAbove: above.length ? above.filter((e) => e.headCorrect).length / above.length : 0,
    };
  });
  return { bins, ece, flags };
}

/** Attachment accuracy by gold relation, to see which constructions are hard. */
export function byRelation(edges: EdgeObs[]): { deprel: string; count: number; uas: number; las: number }[] {
  const groups = new Map<string, EdgeObs[]>();
  for (const e of edges) groups.set(e.goldDeprel, [...(groups.get(e.goldDeprel) ?? []), e]);
  return [...groups.entries()]
    .map(([deprel, es]) => ({
      deprel,
      count: es.length,
      uas: es.filter((e) => e.headCorrect).length / es.length,
      las: es.filter((e) => e.labelCorrect).length / es.length,
    }))
    .sort((a, b) => b.count - a.count);
}

/** Attachment accuracy by how far away the right head is. */
export function byDistance(edges: EdgeObs[]): { distance: string; count: number; top: number; final: number }[] {
  const bins = [[1, 1], [2, 2], [3, 4], [5, 8], [9, Infinity]] as const;
  return bins.map(([lo, hi]) => {
    const es = edges.filter((e) => e.goldHead > 0 && Math.abs(e.goldHead - e.word) >= lo && Math.abs(e.goldHead - e.word) <= hi);
    return {
      distance: hi === Infinity ? `${lo}+` : lo === hi ? `${lo}` : `${lo}–${hi}`,
      count: es.length,
      top: es.length ? es.filter((e) => e.argmaxCorrect).length / es.length : 0,
      final: es.length ? es.filter((e) => e.headCorrect).length / es.length : 0,
    };
  });
}
