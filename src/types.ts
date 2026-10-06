import type { JevClient, JevRequest, JevResponse } from "./jev/types.ts";

/** What a strategy parses: raw text (tokenized by `tokenize`) or pre-split words (gold tokens in evals). */
export type ParseInput = string | { words: string[]; text?: string };

export interface ParsedToken {
  /** 1-based position, as in CoNLL-U. */
  id: number;
  form: string;
  upos: string;
  /** Distribution over UPOS tags (empty for rule baselines). */
  uposDist: Record<string, number>;
  /** Best / second-best score for the tag; Infinity when there was no model judgment. */
  uposSeparation: number;
}

export interface Edge {
  dep: number;
  /** 0 means the artificial root. */
  head: number;
  deprel: string;
  /** Jev's probability for the head the decoder chose (1 for rule baselines). */
  p: number;
  /** Top / second probability among the head options: Jev's ambiguity about this attachment. */
  separation: number;
  /** The head Jev ranked first, before decoding. */
  argmaxHead: number;
  /** Head option probabilities keyed by word id ("0" is root). */
  headDist: Record<string, number>;
  /** Relation distribution and separation, when a model labeled the edge. */
  deprelDist?: Record<string, number>;
  deprelSeparation?: number;
}

export interface TraceEntry {
  stage: string;
  request: JevRequest;
  response: JevResponse;
  ms: number;
}

export interface ParseStats {
  requests: number;
  questions: number;
  /** Wall time spent waiting on the Jev client. */
  jevMs: number;
  inputTokens: number;
  outputTokens: number;
  /** Size of the request bodies sent (JSON characters), a cost proxy that works offline. */
  requestChars: number;
  /** Words whose decoded head differs from Jev's first-ranked head. */
  argmaxDisagreements: number;
  /**
   * Pairs of words whose first-ranked heads point at each other (a 2-cycle before decoding), e.g.
   * "across" → "yard" and "yard" → "across". A sign that Jev and UD disagree about which word heads.
   */
  argmaxMutualPairs: number;
}

export interface ParseResult {
  strategy: string;
  text: string;
  tokens: ParsedToken[];
  edges: Edge[];
  conllu: string;
  trace: TraceEntry[];
  stats: ParseStats;
}

export interface Strategy {
  name: string;
  description: string;
  parse(input: ParseInput, client: JevClient): Promise<ParseResult>;
}
