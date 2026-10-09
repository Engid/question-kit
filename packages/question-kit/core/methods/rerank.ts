// rerank: put a shortlist of candidates in order, best match first.
//
// A cheap first pass (keyword search, embeddings, a database query) finds candidates; then one Noul
// per candidate asks whether it's what the query is looking for, and code sorts by that
// probability. By default each candidate gets its own request with just the query and that
// candidate, so the others can't distract; `perRequest` puts several candidates in one request to
// save tokens on long queries.
// Based on the approach in TypeSafe's "Re-ranking" cookbook.

import type { SystemOneCall, SystemOneClient, Json } from "../system-one.ts";
import { noul } from "../questions.ts";
import { readNoul } from "../readings.ts";
import { keyed } from "../state.ts";
import { run } from "../task.ts";

export interface RerankOptions {
  /**
   * What a match is: a statement about one candidate and the query, true when it matches.
   * Default: "The candidate is what the query is looking for."
   */
  match?: { statement: string; true?: string; false?: string };
  /** Candidates per request. Default 1. */
  perRequest?: number;
  /** Requests in flight at once. Default 8. */
  concurrency?: number;
  log?: SystemOneCall[];
}

export interface Ranked<C> {
  candidate: C;
  index: number;
  probability: number;
}

export async function rerank<C extends Json>(client: SystemOneClient, query: Json, candidates: C[], opts: RerankOptions = {}): Promise<Ranked<C>[]> {
  const match = opts.match ?? { statement: "The candidate is what the query is looking for." };
  const per = Math.max(1, opts.perRequest ?? 1);
  const groups: number[][] = [];
  for (let i = 0; i < candidates.length; i += per) groups.push(Array.from({ length: Math.min(per, candidates.length - i) }, (_, k) => i + k));
  const probs: number[] = new Array(candidates.length).fill(0);
  const criteria = match.true || match.false ? { true: match.true, false: match.false } : undefined;
  const one = async (g: number[]) => {
    const single = g.length === 1;
    const res = await run(
      client,
      {
        parts: single ? { query, candidate: candidates[g[0]!]! } : { query, candidates: keyed(g.map((i) => candidates[i]!), "c") },
        questions: (at) =>
          Object.fromEntries(
            g.map((_, k) => {
              const c = single ? at("candidate") : at("candidates").at(`c${k + 1}`);
              return [`c${k + 1}`, noul(`${match.statement.replace(/\bthe candidate\b/i, String(c)).replace(/\bthe query\b/i, String(at("query")))}`, criteria)];
            }),
          ),
        read: (a) => g.map((_, k) => readNoul(a[`c${k + 1}`]).probability),
      },
      { log: opts.log, title: "rerank" },
    );
    g.forEach((i, k) => {
      probs[i] = res[k]!;
    });
  };
  const limit = Math.max(1, opts.concurrency ?? 8);
  for (let i = 0; i < groups.length; i += limit) await Promise.all(groups.slice(i, i + limit).map(one));
  return candidates.map((candidate, index) => ({ candidate, index, probability: probs[index]! })).sort((x, y) => y.probability - x.probability);
}
