// Scoring against gold trees, following the CoNLL 2018 shared task conventions: every word counts
// (punctuation included), and relations are compared on their universal part only (`nmod:poss` →
// `nmod`). https://universaldependencies.org/conll18/evaluation.html
// Evals use gold words, so no alignment step is needed.

import type { ParseResult } from "../src/types.ts";
import type { ConlluSentence } from "../src/ud/conllu.ts";
import { universalDeprel } from "../src/ud/deprel.ts";
import { bucketOf } from "./data.ts";

export interface EdgeObs {
  /** False for rule baselines and other unscored predictions; calibration uses judged edges only. */
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
  const byDep = new Map(r.edges.map((e) => [e.dep, e]));
  const ids = r.tokens.map((t) => t.id);
  return {
    upos: r.tokens.map((t) => t.upos),
    heads: ids.map((id) => byDep.get(id)?.head ?? -1),
    deprels: ids.map((id) => byDep.get(id)?.deprel ?? "_"),
    p: ids.map((id) => byDep.get(id)?.p ?? 1),
    separation: ids.map((id) => byDep.get(id)?.separation ?? Infinity),
    argmaxHeads: ids.map((id) => byDep.get(id)?.argmaxHead ?? -1),
    judged: ids.map((id) => Object.keys(byDep.get(id)?.headDist ?? {}).length > 0),
  };
}

export function scoreSentence(gold: ConlluSentence, pred: Prediction, stats?: ParseResult["stats"]): SentenceScore {
  const n = gold.words.length;
  if (pred.heads.length !== n) throw new Error(`${gold.sentId}: ${pred.heads.length} predicted words vs ${n} gold`);
  let upos = 0;
  let uas = 0;
  let las = 0;
  const edges: EdgeObs[] = [];
  gold.words.forEach((g, i) => {
    const headOk = pred.heads[i] === g.head;
    const labelOk = headOk && universalDeprel(pred.deprels[i] ?? "") === universalDeprel(g.deprel);
    if (pred.upos[i] === g.upos) upos++;
    if (headOk) uas++;
    if (labelOk) las++;
    edges.push({
      judged: pred.judged?.[i] ?? false,
      p: pred.p?.[i] ?? 1,
      separation: pred.separation?.[i] ?? Infinity,
      headCorrect: headOk,
      labelCorrect: labelOk,
      argmaxCorrect: (pred.argmaxHeads?.[i] ?? pred.heads[i]) === g.head,
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

export interface Aggregate {
  sentences: number;
  words: number;
  upos: number;
  uas: number;
  las: number;
  /** UAS if each word took Jev's first-ranked head, before decoding. */
  argmaxUas: number;
  requestsPerSentence: number;
  questionsPerSentence: number;
  jevMsPerSentence: number;
  inputTokensPerSentence: number;
  outputTokensPerSentence: number;
  requestCharsPerSentence: number;
  /** Share of words whose decoded head differs from Jev's first-ranked head. */
  argmaxDisagreementRate: number;
  /** Pairs of words whose first-ranked heads point at each other, per 100 words. */
  mutualPairsPer100Words: number;
}

export function aggregate(scores: SentenceScore[]): Aggregate {
  const words = scores.reduce((a, s) => a + s.n, 0);
  const sum = (f: (s: SentenceScore) => number) => scores.reduce((a, s) => a + f(s), 0);
  const per = (f: (s: SentenceScore) => number) => (scores.length ? sum(f) / scores.length : 0);
  const edges = scores.flatMap((s) => s.edges);
  return {
    sentences: scores.length,
    words,
    upos: words ? sum((s) => s.upos) / words : 0,
    uas: words ? sum((s) => s.uas) / words : 0,
    las: words ? sum((s) => s.las) / words : 0,
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

export interface ReliabilityBin {
  lo: number;
  hi: number;
  count: number;
  meanP: number;
  accuracy: number;
}

export interface Calibration {
  bins: ReliabilityBin[];
  /** Expected calibration error of p (the decoded head's probability) against head correctness. */
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

/** Per-relation head accuracy, to see which constructions are hard. */
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
