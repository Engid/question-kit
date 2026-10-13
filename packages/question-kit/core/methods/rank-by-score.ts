// rankByScore: put items in order by rating each one on levels you write, then sorting.
//
// One Score per item, all in one request. Jev answers a Score with a probability for every level,
// so each item gets an expected level (the probability-weighted average: 70% level 3, 25% level 2
// and 5% level 1 is 2.65), and items are sorted by that. Sorting by the expected level instead of
// the single most likely level is what makes this work: items that share a most likely level
// still come apart by how sure Jev was.
//
// When to use it: ordering a list by a judgement you can describe as levels (relevance, quality,
// readability, closeness in meaning). It's n questions for n items, and the items never see each
// other, so it scales to long lists and to items scored at different times. In our evals it
// ordered lists about as well as `rankPairwise`, and better on some, for fewer questions, and it
// ordered whole lists much better than one Choice over all the items. Sorting the same answers by
// the single most likely level ordered them worse than `rankPairwise`, so keep the expected level.
// Use `rankPairwise` instead when you can't write good levels, or when items only make sense
// compared with each other. For one yes-or-no "is this a match?", `rerank` asks a Noul per item.
//
// Levels: lowest first, each a sentence saying what that level means, the way an annotation
// guideline would. TypeSafe's guidance on Scores: https://docs.typesafe.ai/primitives/score.md

import type { Entry, Json } from "../system-one.ts";
import { score } from "../questions.ts";
import { readScore, type ScoreReading } from "../readings.ts";
import { keyed, q, type Ref } from "../state.ts";
import type { Task } from "../task.ts";

export interface RankByScoreOptions {
  /** The levels, lowest first, each saying what it means. */
  levels: Entry[];
  /**
   * The question for one item: a statement after "About `items.i3`:", or the whole question as a
   * function of the item's Ref (and `query`'s). Default, with `query`: "How relevant is `items.i3`
   * to `query`?".
   */
  question?: string | ((item: Ref, query: Ref | undefined) => string);
  /** What the items are judged against (a search query, a customer's message), sent once as `query`. */
  query?: Json;
  /** Where the items go in the state. Default "items" (`items.i1`, `items.i2`, …). */
  name?: string;
}

export interface ScoredItem<T> extends ScoreReading {
  item: T;
  /** Position in the input list. */
  index: number;
  /** The item's key in the state (`i1`, `i2`, …). */
  key: string;
  /**
   * The chance this item's level is above the next one's, with a tie counting half, taking the two
   * answers' level probabilities as independent; undefined for the last.
   */
  beatsNext?: number;
}

export interface ScoreRanking<T> {
  /** Best first: highest expected level (`value`); equal values keep input order. */
  ranked: ScoredItem<T>[];
  /** `beatsNext` of the top item (1 when there's one item). */
  confidence: number;
}

/** The chance a level drawn from `a` is above one drawn from `b`, ties counting half. */
export function above(a: number[], b: number[]): number {
  let p = 0;
  a.forEach((pa, i) => b.forEach((pb, j) => (p += pa * pb * (i > j ? 1 : i === j ? 0.5 : 0))));
  return p;
}

/**
 * Rank items by a Score each: one Score per item, all in one request, sorted by expected level.
 *
 * ```ts
 * const r = await run(client, rankByScore(passages, {
 *   query: "how do I reset my password?",
 *   levels: ["Unrelated to the query.", "Related, but doesn't answer it.", "Answers part of it.", "Answers it exactly."],
 * }));
 * r.ranked[0].item; // the most relevant passage
 * ```
 */
export function rankByScore<T extends Json>(items: T[], opts: RankByScoreOptions): Task<ScoreRanking<T>> {
  if (opts.levels.length < 2) throw new Error("rankByScore needs at least 2 levels");
  if (opts.question === undefined && opts.query === undefined) throw new Error("rankByScore needs `question` or `query` to say what's being rated");
  const name = opts.name ?? "items";
  const keys = items.map((_, i) => `i${i + 1}`);
  const parts: Record<string, Json> = { [name]: keyed(items, "i") };
  if (opts.query !== undefined) parts.query = opts.query;
  return {
    parts,
    questions: (at) => {
      const query = opts.query !== undefined ? at("query") : undefined;
      return Object.fromEntries(
        keys.map((k) => {
          const item = at(name).at(k);
          const text = typeof opts.question === "function" ? opts.question(item, query) : opts.question !== undefined ? q`About ${item}: ${opts.question}` : q`How relevant is ${item} to ${query}?`;
          return [k, score(text, opts.levels)];
        }),
      );
    },
    read: (answers) => {
      const ranked: ScoredItem<T>[] = items
        .map((item, index) => ({ ...readScore(answers[keys[index]!]), item, index, key: keys[index]! }))
        .sort((x, y) => y.value - x.value || x.index - y.index);
      ranked.forEach((r, i) => {
        const next = ranked[i + 1];
        if (next) r.beatsNext = above(r.probabilities, next.probabilities);
      });
      return { ranked, confidence: ranked[0]?.beatsNext ?? 1 };
    },
  };
}
