// Assembles a ParseResult at the end of a strategy: the words with their types, the attachments
// with who decided them, the relationship names, a CoNLL-U rendering and the call statistics.

import { CallLog } from "../../lab/calls.ts";
import { separation } from "../../lab/jev/confidence.ts";
import type { Relationship } from "./question-sets/relationship.ts";
import type { Sentence } from "./sentence.ts";
import type { DecidedBy, Edge, ParsedToken, ParseResult } from "./types.ts";
import { writeConllu } from "./ud/conllu.ts";
import type { HeadVotes } from "./votes.ts";

export interface Finish {
  strategy: string;
  s: Sentence;
  log?: CallLog;
  /** Word types for words 1..n, with Jev's distribution when Jev answered. */
  types: { type: string; dist?: Record<string, number>; separation?: number }[];
  /** heads[id] for id 1..n (index 0 unused). */
  heads: number[];
  /** The attachment votes, when Jev voted. */
  votes?: HeadVotes;
  /** Words moved by a cleanup rule. */
  cleaned?: Set<number>;
  /** Relationship per word: Jev's answer, a rule's label, or undefined ("dep"). */
  relationship?: (word: number) => Relationship | string | undefined;
}

export function finish(f: Finish): ParseResult {
  const { s } = f;
  const n = s.words.length;
  const tokens: ParsedToken[] = s.words.map((form, i) => {
    const t = f.types[i];
    return {
      id: i + 1,
      form,
      upos: t?.type ?? "X",
      uposDist: t?.dist ?? {},
      uposSeparation: t?.separation ?? Infinity,
    };
  });
  const top = f.votes?.topHeads();
  const edges: Edge[] = [];
  for (let d = 1; d <= n; d++) {
    const head = f.heads[d] as number;
    const dist = f.votes?.combined(d) ?? {};
    const voted = Object.keys(dist).length > 0;
    const argmaxHead = voted ? (top?.[d] as number) : head;
    const by: DecidedBy = !voted ? "rules" : f.cleaned?.has(d) ? "cleanup" : head === argmaxHead ? "jev" : "tree";
    const edge: Edge = {
      dep: d,
      head,
      deprel: "dep",
      by,
      p: voted ? (dist[head] ?? 0) : 1,
      separation: voted ? separation(Object.values(dist)) : Infinity,
      argmaxHead,
      headDist: dist,
    };
    if (head === 0) edge.deprel = "root";
    else {
      const r = f.relationship?.(d);
      if (typeof r === "string") edge.deprel = r;
      else if (r) {
        edge.deprel = r.rel;
        edge.deprelDist = r.dist;
        edge.deprelSeparation = r.separation;
      }
    }
    edges.push(edge);
  }
  const log = f.log ?? new CallLog({ name: "none", systemOne: async () => ({ model: "", answers: {} }) });
  const argmax = edges.map((e) => e.argmaxHead);
  return {
    strategy: f.strategy,
    text: s.text,
    tokens,
    edges,
    conllu: toConllu(s.text, tokens, edges, f.strategy),
    calls: log.calls,
    steps: log.steps,
    stats: {
      ...log.stats,
      argmaxDisagreements: edges.filter((e) => e.head !== e.argmaxHead).length,
      argmaxMutualPairs: argmax.filter((h, i) => h > i + 1 && argmax[h - 1] === i + 1).length,
    },
  };
}

/** Separation for display: past 1000 the ratio only means "very clear". */
export function fmtSep(s: number): string {
  if (!Number.isFinite(s)) return "—";
  return s >= 1000 ? "1000+" : s.toFixed(2);
}

function toConllu(text: string, tokens: ParsedToken[], edges: Edge[], strategy: string): string {
  return writeConllu(
    tokens.map((t, i) => {
      const e = edges[i] as Edge;
      const judged = Object.keys(e.headDist).length > 0;
      return { form: t.form, upos: t.upos, head: e.head, deprel: e.deprel, misc: judged ? `JevP=${e.p.toFixed(3)}|JevSep=${fmtSep(e.separation)}` : undefined };
    }),
    { text, comments: [`# parser = question-kit/${strategy}`] },
  );
}
