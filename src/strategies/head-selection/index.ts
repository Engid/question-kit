// Graph-based dependency parsing as head selection, with Jev as the scorer.
//
//   1. POS:        one Choice per word over the 17 UPOS tags (flat, or open/closed/other then fine).
//   2. Heads:      one Choice per word: which other word (or root) is its head?
//   3. Decode:     treat head probabilities as edge weights and take the maximum spanning
//                  arborescence with one root child (Chu-Liu/Edmonds), so the output is a tree.
//   4. Relations:  for each decoded edge, a coarse Choice over relation groups and a fine Choice
//                  within each group, combined by TypeSafe's geometric-mean path rule.
//
// Head selection follows Zhang, Cheng & Lapata (2017), "Dependency Parsing as Head Selection"
// (EACL), who select each word's head independently and fix non-tree outputs with an MST decoder.

import { argmax, composeTwoLevel, separation } from "../../jev/confidence.ts";
import { choiceAnswer, type JevClient, type JevResponse, type Questions } from "../../jev/types.ts";
import { decodeSingleRoot, NEG } from "../../decode/cle.ts";
import type { Edge, ParseInput, ParsedToken, ParseResult, Strategy } from "../../types.ts";
import { DEPREL_GROUPS, type DeprelGroup } from "../../ud/deprel.ts";
import { UPOS_GROUPS, type UposGroup } from "../../ud/upos.ts";
import { DEFAULT_MAX_REQUEST_TOKENS, normalizeInput, Session, toConllu } from "../common.ts";
import {
  buildState,
  headId,
  headQuestions,
  headRevId,
  type HintVersion,
  type OptionOrder,
  optionToHead,
  posFineId,
  posGroupId,
  posId,
  posQuestions,
  range,
  relationQuestions,
  relFineId,
  relGroupId,
  type WordContext,
} from "./questions.ts";

/** Rules that remove head candidates using the POS answers. Only used with `requests: "three-stage"`. */
export type PruneRule =
  /** Punctuation is never offered as a head. */
  | "no-punct-heads"
  /** Determiners, prepositions, conjunctions, particles, auxiliaries and punctuation are never offered as heads. */
  | "no-function-heads";

export interface HeadSelectionOptions {
  pos: "flat" | "hierarchical";
  /**
   * single:      POS, heads and (head-agnostic) relations in one request.
   * two-stage:   POS and heads in one request, then relations for the decoded edges.
   * three-stage: POS, then heads (pruned with the POS answers), then relations.
   */
  requests: "single" | "two-stage" | "three-stage";
  prune: PruneRule[];
  /**
   * The same rules applied at decode time instead: Jev is still asked about every candidate, and
   * banned heads are removed from the score matrix before the MST. Needs no extra request, so it
   * can be evaluated on cached answers.
   */
  decodeMask: PruneRule[];
  /**
   * After decoding, re-attach introducing function words the UD way. A preposition, subordinator
   * or coordinator (by its POS answer) whose head lies to its left, and which has a later sibling
   * under that same head, is moved onto the first such sibling: "chased across the yard" with
   * across → chased and yard → chased becomes across → yard. Added after the first 125-sentence
   * run showed these words mostly taking their grandparent (the phrase's attachment point) as head.
   * Only applied to leaves, so the result is still a tree.
   */
  reattachFunctionWords: boolean;
  decode: "mst" | "argmax";
  order: OptionOrder;
  context: WordContext;
  /** Which statement of UD's attachment conventions to add to the head question. */
  hints: HintVersion;
  /** Ask the relation questions. Off: every non-root edge is labeled `dep` (for UAS-only runs on cached heads). */
  labels: boolean;
  /** Label a word tagged PUNCT as `punct` without asking (three-stage and two-stage only). */
  punctShortcut: boolean;
  /** Split a request when it has more questions than this (0 = never split). */
  maxQuestionsPerRequest: number;
  /** Split a request when its estimated input tokens exceed this (0 = never split). */
  maxRequestTokens: number;
}

export const DEFAULT_OPTIONS: HeadSelectionOptions = {
  pos: "flat",
  requests: "two-stage",
  prune: [],
  decodeMask: [],
  reattachFunctionWords: false,
  decode: "mst",
  order: "sentence",
  context: "path",
  hints: "v1",
  labels: true,
  punctShortcut: false,
  maxQuestionsPerRequest: 0,
  maxRequestTokens: DEFAULT_MAX_REQUEST_TOKENS,
};

const FUNCTION_TAGS = new Set(["DET", "ADP", "CCONJ", "SCONJ", "PART", "AUX", "PUNCT"]);

export function headSelection(name: string, overrides: Partial<HeadSelectionOptions> = {}): Strategy & { options: HeadSelectionOptions } {
  const options: HeadSelectionOptions = { ...DEFAULT_OPTIONS, ...overrides };
  if (options.prune.length > 0 && options.requests !== "three-stage") {
    throw new Error(`${name}: pruning uses POS answers, so it needs requests: "three-stage"`);
  }
  return {
    name,
    options,
    description: describe(options),
    parse: (input, client) => parse(name, input, client, options),
  };
}

function describe(o: HeadSelectionOptions): string {
  const parts = [`${o.pos} POS`, o.requests, o.decode === "mst" ? "MST decode" : "argmax heads"];
  if (o.prune.length) parts.push(`pruned: ${o.prune.join(", ")}`);
  if (o.decodeMask.length) parts.push(`decode mask: ${o.decodeMask.join(", ")}`);
  if (o.reattachFunctionWords) parts.push("function words re-attached");
  if (o.order !== "sentence") parts.push(`${o.order} option order`);
  if (o.context !== "path") parts.push(`${o.context} context`);
  if (o.hints !== "v1") parts.push(o.hints === "none" ? "no UD hints" : `UD hints ${o.hints}`);
  if (o.punctShortcut) parts.push("punct shortcut");
  if (!o.labels) parts.push("unlabeled");
  return parts.join(" · ");
}

async function parse(name: string, input: ParseInput, client: JevClient, o: HeadSelectionOptions): Promise<ParseResult> {
  const { words, text } = normalizeInput(input);
  const n = words.length;
  const state = buildState(words, text, o.context);
  const session = new Session(client, { maxQuestionsPerRequest: o.maxQuestionsPerRequest, maxRequestTokens: o.maxRequestTokens });

  const posQs = posQuestions(n, o.pos);
  let tokens: ParsedToken[];
  let headRes: JevResponse;
  let relRes: JevResponse | undefined;

  if (o.requests === "single") {
    const qs: Questions = { ...posQs, ...headQuestions(words, { order: o.order, hints: o.hints }) };
    if (o.labels) for (let d = 1; d <= n; d++) Object.assign(qs, relationQuestions(d, undefined));
    const res = await session.ask("all", state, qs);
    tokens = readPos(res, words, o.pos);
    headRes = res;
    relRes = res;
  } else if (o.requests === "two-stage") {
    const res = await session.ask("pos+heads", state, { ...posQs, ...headQuestions(words, { order: o.order, hints: o.hints }) });
    tokens = readPos(res, words, o.pos);
    headRes = res;
  } else {
    const posRes = await session.ask("pos", state, posQs);
    tokens = readPos(posRes, words, o.pos);
    const candidates = pruner(tokens, o.prune);
    headRes = await session.ask("heads", state, headQuestions(words, { order: o.order, hints: o.hints, candidates }));
  }

  // Head distributions → decode.
  const headDists = range(1, n).map((d) => readHeadDist(headRes, d, o.order));
  const scores: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(n + 1).fill(NEG));
  headDists.forEach((dist, i) => {
    const d = i + 1;
    for (const [h, p] of Object.entries(dist)) (scores[Number(h)] as number[])[d] = Math.log(Math.max(p, 1e-6));
  });
  const argmaxHeads = headDists.map((dist) => Number(argmax(dist)));
  const mask = pruner(tokens, o.decodeMask);
  if (mask) {
    for (let d = 1; d <= n; d++) {
      const allowed = new Set(mask(d));
      for (let h = 0; h <= n; h++) if (!allowed.has(h)) (scores[h] as number[])[d] = NEG;
    }
  }
  const decoded = o.decode === "mst" ? decodeSingleRoot(scores).heads.slice(1) : argmaxHeads.slice();
  const heads = o.reattachFunctionWords ? reattachFunctionWords(decoded, tokens) : decoded;

  // Relations for the decoded edges.
  if (o.requests !== "single" && o.labels) {
    const qs: Questions = {};
    heads.forEach((h, i) => {
      const d = i + 1;
      if (h === 0) return;
      if (o.punctShortcut && tokens[i]?.upos === "PUNCT") return;
      Object.assign(qs, relationQuestions(d, h));
    });
    relRes = Object.keys(qs).length > 0 ? await session.ask("relations", state, qs) : { model: "", answers: {} };
  }

  const edges: Edge[] = heads.map((h, i) => {
    const d = i + 1;
    const dist = headDists[i] as Record<string, number>;
    const edge: Edge = {
      dep: d,
      head: h,
      deprel: "dep",
      p: dist[String(h)] ?? 0,
      separation: separation(Object.values(dist)),
      argmaxHead: argmaxHeads[i] as number,
      headDist: dist,
    };
    if (h === 0) {
      edge.deprel = "root";
    } else if (o.punctShortcut && o.requests !== "single" && tokens[i]?.upos === "PUNCT") {
      edge.deprel = "punct";
    } else if (relRes && relRes.answers[relGroupId(d)]) {
      const rel = readRelation(relRes, d);
      edge.deprel = rel.best;
      edge.deprelDist = rel.distribution;
      edge.deprelSeparation = rel.separation;
    }
    return edge;
  });

  session.stats.argmaxDisagreements = edges.filter((e) => e.head !== e.argmaxHead).length;
  session.stats.argmaxMutualPairs = argmaxHeads.filter((h, i) => h > i + 1 && argmaxHeads[h - 1] === i + 1).length;
  return {
    strategy: name,
    text,
    tokens,
    edges,
    conllu: toConllu(text, tokens, edges, name),
    trace: session.trace,
    stats: session.stats,
  };
}

function readPos(res: JevResponse, words: string[], mode: "flat" | "hierarchical"): ParsedToken[] {
  return words.map((form, i) => {
    const id = i + 1;
    if (mode === "flat") {
      const a = choiceAnswer(res, posId(id));
      return { id, form, upos: argmax(a.probabilities), uposDist: a.probabilities, uposSeparation: separation(Object.values(a.probabilities)) };
    }
    const group = choiceAnswer(res, posGroupId(id)).probabilities;
    const fine: Record<string, Record<string, number>> = {};
    for (const g of Object.keys(UPOS_GROUPS) as UposGroup[]) fine[g] = choiceAnswer(res, posFineId(id, g)).probabilities;
    const c = composeTwoLevel(group, fine);
    return { id, form, upos: c.best, uposDist: c.distribution, uposSeparation: c.separation };
  });
}

/** Head probabilities keyed by head id ("0" = root). With `both` orders, the two answers are averaged. */
function readHeadDist(res: JevResponse, d: number, order: OptionOrder): Record<string, number> {
  const toIds = (probs: Record<string, number>) =>
    Object.fromEntries(Object.entries(probs).map(([opt, p]) => [String(optionToHead(opt)), p]));
  if (!res.answers[headId(d)]) return { "0": 1 }; // not asked: the root was the only candidate
  const first = toIds(choiceAnswer(res, headId(d)).probabilities);
  if (order !== "both") return first;
  const second = toIds(choiceAnswer(res, headRevId(d)).probabilities);
  return Object.fromEntries(Object.keys(first).map((h) => [h, ((first[h] ?? 0) + (second[h] ?? 0)) / 2]));
}

function readRelation(res: JevResponse, d: number) {
  const group = choiceAnswer(res, relGroupId(d)).probabilities;
  const fine: Record<string, Record<string, number>> = {};
  for (const g of Object.keys(DEPREL_GROUPS) as DeprelGroup[]) fine[g] = choiceAnswer(res, relFineId(d, g)).probabilities;
  return composeTwoLevel(group, fine);
}

function pruner(tokens: ParsedToken[], rules: PruneRule[]): ((dep: number) => number[]) | undefined {
  if (rules.length === 0) return undefined;
  const banned = new Set<number>();
  for (const t of tokens) {
    if (rules.includes("no-punct-heads") && t.upos === "PUNCT") banned.add(t.id);
    if (rules.includes("no-function-heads") && FUNCTION_TAGS.has(t.upos)) banned.add(t.id);
  }
  const all = range(0, tokens.length);
  return (dep) => {
    const kept = all.filter((h) => h !== dep && !banned.has(h));
    // Never leave a word with only the root to choose from unless the sentence is one word.
    return kept.length > 1 || tokens.length === 1 ? kept : all.filter((h) => h !== dep);
  };
}

const INTRODUCERS = new Set(["ADP", "SCONJ", "CCONJ"]);

/** See `reattachFunctionWords` in HeadSelectionOptions. `heads[i]` is the head of word i + 1. */
export function reattachFunctionWords(heads: number[], tokens: ParsedToken[]): number[] {
  const out = heads.slice();
  const hasDependents = (id: number) => out.some((h) => h === id);
  tokens.forEach((t, i) => {
    const f = i + 1;
    if (!INTRODUCERS.has(t.upos) || hasDependents(f)) return;
    const h = out[i] as number;
    if (h > f) return; // already attached to something on its right
    for (let j = f + 1; j <= tokens.length; j++) {
      const tag = tokens[j - 1]?.upos ?? "";
      if (out[j - 1] === h && tag !== "PUNCT" && !INTRODUCERS.has(tag)) {
        out[i] = j;
        return;
      }
    }
  });
  return out;
}
