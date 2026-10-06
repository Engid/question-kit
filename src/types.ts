import type { CallRecord, CallStats, CodeStep } from "./calls.ts";
import type { JevClient } from "./jev/types.ts";
import type { ParseInput } from "./sentence.ts";

export type { ParseInput } from "./sentence.ts";

export interface ParsedToken {
  /** 1-based position, as in CoNLL-U. */
  id: number;
  form: string;
  /** Word type (UD part of speech). */
  upos: string;
  /** Probability per word type (empty when code decided). */
  uposDist: Record<string, number>;
  /** Best / second-best probability for the word type; Infinity when code decided. */
  uposSeparation: number;
}

/** Who decided an attachment. */
export type DecidedBy =
  /** Jev's (combined) top answer. */
  | "jev"
  /** The tree builder picked something other than Jev's top answer, to make a valid tree. */
  | "tree"
  /** A code cleanup rule moved it. */
  | "cleanup"
  /** Rules only. */
  | "rules";

export interface Edge {
  dep: number;
  /** 0 means the root (this is the main word). */
  head: number;
  deprel: string;
  by: DecidedBy;
  /** Jev's (combined) probability for the chosen head; 1 when code decided. */
  p: number;
  /** Top / second probability among head candidates: how clear-cut Jev's answer was. */
  separation: number;
  /** The head Jev ranked first. */
  argmaxHead: number;
  /** Probability per head id (combined over question sets); empty when code decided. */
  headDist: Record<string, number>;
  deprelDist?: Record<string, number>;
  deprelSeparation?: number;
}

export interface ParseStats extends CallStats {
  /** Words whose final head differs from Jev's first-ranked head. */
  argmaxDisagreements: number;
  /** Pairs of words whose first-ranked heads point at each other (a 2-word loop before tree building). */
  argmaxMutualPairs: number;
}

export interface ParseResult {
  strategy: string;
  text: string;
  tokens: ParsedToken[];
  edges: Edge[];
  conllu: string;
  /** Every Jev call, with questions, answers and what each question was about. */
  calls: CallRecord[];
  /** What code did between calls, in plain words. */
  steps: CodeStep[];
  stats: ParseStats;
}

export interface Strategy {
  name: string;
  /** Rung on the ladder (0 = all code … 4 = all Jev), when the strategy is part of it. */
  rung?: number;
  /** One line, plain English. */
  summary: string;
  /** Where it sits: the ladder, question design, or an experiment on a single knob. */
  group: "ladder" | "question-design" | "experiment" | "baseline";
  parse(input: ParseInput, jev: JevClient): Promise<ParseResult>;
  /** The same strategy without the relationship questions (for attachment-only runs). */
  unlabeled?(): Strategy;
}
