// rankPairwise: put items in order by asking which of two is better, pair by pair.
//
// Asks "which of these two is better?" as one two-option Choice per pair, all in one request,
// alternating which item is offered first, and fits Bradley–Terry strengths to the answers: each
// item gets a strength, and the chance that `a` beats `b` is 1 / (1 + e^(strength_b − strength_a)).
// Each answer counts as a soft win: 0.8 for `a` is 0.8 of a win for `a` and 0.2 for `b`.
//
// When to use it: the usual argument for pairwise ranking is that a rating scale bunches items on a
// few levels. With Jev a Score comes back as a probability for every level, and sorting by its
// expected level (`rankByScore`) separates items that share a most-likely level. In
// our evals, sorting by the most likely level alone (what a model that answers with one number
// gives you) ordered lists worse than this method; sorting by the expected level ordered them about
// as well, and better on some, for fewer questions. This method ordered whole lists much better
// than one Choice over all the items.
// Reach for it when you can't write good levels for the judgement, when you want strengths and
// "chance a beats b" rather than a level, or when items only make sense compared with each other.
// Every pair is one question, so n items is n·(n−1)/2 questions; past about 30 items, give
// `opponents` to compare each item with only that many others. For "which one is best?",
// `choose` is one question.
//
// Bradley–Terry: R. A. Bradley and M. E. Terry, "Rank Analysis of Incomplete Block Designs",
// Biometrika 39 (1952). The fit is Hunter's MM algorithm: D. R. Hunter, "MM algorithms for
// generalized Bradley–Terry models", Annals of Statistics 32 (2004).

import type { Json } from "../system-one.ts";
import { choice } from "../questions.ts";
import { readChoice } from "../readings.ts";
import { keyed, q, type Ref } from "../state.ts";
import type { Task } from "../task.ts";

export interface RankPairwiseOptions {
  /**
   * What makes one item better than the other, to finish "Which is ___: `a` or `b`?". For example
   * "more relevant to `query`" (with `query`), or "the clearer explanation". Default, with
   * `query`: "more relevant to `query`".
   */
  better?: string | ((query: Ref | undefined) => string);
  /** The whole question, as a function of the two items' Refs, instead of `better`. */
  question?: (a: Ref, b: Ref, query: Ref | undefined) => string;
  /** What the items are judged against (a search query, a customer's message), sent once as `query`. */
  query?: Json;
  /**
   * Compare each item with this many others instead of with all of them: item i meets items
   * i+1 … i+k (wrapping around), so every item plays 2k games and the comparisons stay connected.
   * Default: all pairs.
   */
  opponents?: number;
  /**
   * Ask each pair in both orders, to cancel any lean toward the option offered first and to
   * measure it (`orderGap`). Default false: each pair is asked once, and which item comes first
   * alternates so no item is always offered first. In our evals Jev's lean was small and asking
   * both orders didn't change the rankings, so it isn't worth twice the questions by default.
   */
  bothOrders?: boolean;
  /**
   * Pseudo-wins added to both sides of every pair that was compared, so an item that wins every
   * game still gets a finite strength. Default 0.1.
   */
  prior?: number;
  /** Where the items go in the state. Default "items" (`items.i1`, `items.i2`, …). */
  name?: string;
}

export interface RankedItem<T> {
  item: T;
  /** Position in the input list. */
  index: number;
  /** The item's key in the state (`i1`, `i2`, …). */
  key: string;
  /** Bradley–Terry log-strength, centered so the mean is 0. */
  strength: number;
  /** Soft wins: the sum of this item's probabilities over its games. */
  wins: number;
  /** Games played (each order of a pair is a game). */
  games: number;
  /** The fitted chance this item beats the next one down; undefined for the last. */
  beatsNext?: number;
}

export interface Duel {
  a: number;
  b: number;
  /** Probability `a` is better, as answered with `a` offered first. */
  p: number;
}

export interface PairwiseRanking<T> {
  /** Best first. */
  ranked: RankedItem<T>[];
  /** The fitted chance the top item beats the runner-up (1 when there's one item). */
  confidence: number;
  /**
   * With both orders: the mean, over pairs, of how far the two orders' answers disagree (0 = the
   * order they're offered in makes no difference; 1 = whichever comes first always wins).
   */
  orderGap?: number;
  /** Every answer, for explaining the result. */
  duels: Duel[];
}

/** The pairs to compare, as index pairs [i, j] with i < j. */
export function pairsFor(n: number, opponents?: number): [number, number][] {
  const k = opponents === undefined ? n - 1 : Math.max(1, Math.min(n - 1, Math.floor(opponents)));
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++)
    for (let d = 1; d <= k; d++) {
      const j = (i + d) % n;
      const [a, b] = i < j ? [i, j] : [j, i];
      const id = `${a},${b}`;
      if (a === b || seen.has(id)) continue;
      seen.add(id);
      out.push([a, b]);
    }
  return out.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}

/**
 * Bradley–Terry log-strengths from soft wins. `wins[i][j]` is how much `i` won against `j` (summed
 * over games), `games[i][j]` how many games they played. `prior` pseudo-wins go to both sides of
 * every pair that played. Returns log-strengths centered on 0.
 */
export function bradleyTerry(wins: number[][], games: number[][], opts: { prior?: number; iterations?: number; tolerance?: number } = {}): number[] {
  const n = wins.length;
  const prior = opts.prior ?? 0.1;
  const w = wins.map((row, i) => row.map((x, j) => (games[i]![j]! > 0 ? x + prior : x)));
  const g = games.map((row) => row.map((x) => (x > 0 ? x + 2 * prior : x)));
  const total = w.map((row) => row.reduce((s, x) => s + x, 0));
  let pi = new Array<number>(n).fill(1);
  for (let it = 0; it < (opts.iterations ?? 10_000); it++) {
    const next = pi.map((p, i) => {
      let denom = 0;
      for (let j = 0; j < n; j++) if (j !== i && g[i]![j]! > 0) denom += g[i]![j]! / (p + pi[j]!);
      return denom > 0 ? total[i]! / denom : p;
    });
    // Rescale so the geometric mean is 1.
    const logMean = next.reduce((s, x) => s + Math.log(x), 0) / n;
    const scaled = next.map((x) => x / Math.exp(logMean));
    const change = Math.max(...scaled.map((x, i) => Math.abs(Math.log(x) - Math.log(pi[i]!))));
    pi = scaled;
    if (change < (opts.tolerance ?? 1e-10)) break;
  }
  return pi.map((x) => Math.log(x));
}

const beats = (sa: number, sb: number) => 1 / (1 + Math.exp(sb - sa));

/**
 * Rank items by pairwise comparison: one two-option Choice per pair, all in one request, then a
 * Bradley–Terry fit. The result is best first, with strengths.
 *
 * ```ts
 * const r = await run(client, rankPairwise(passages, { query: "how do I reset my password?" }));
 * r.ranked[0].item; // the most relevant passage
 * ```
 */
export function rankPairwise<T extends Json>(items: T[], opts: RankPairwiseOptions = {}): Task<PairwiseRanking<T>> {
  if (!opts.question && opts.better === undefined && opts.query === undefined) throw new Error("rankPairwise needs `better`, `question` or `query` to say what makes an item better");
  const name = opts.name ?? "items";
  const n = items.length;
  const keys = items.map((_, i) => `i${i + 1}`);
  const pairs = pairsFor(n, opts.opponents);
  const both = opts.bothOrders ?? false;
  // Each game: [question id, first offered, second offered].
  const games: [string, number, number][] = [];
  for (const [a, b] of pairs) {
    const [first, second] = both || firstOf(a, b) === a ? [a, b] : [b, a];
    games.push([`${keys[first]}_${keys[second]}`, first, second]);
    if (both) games.push([`${keys[b]}_${keys[a]}`, b, a]);
  }
  const parts: Record<string, Json> = { [name]: keyed(items, "i") };
  if (opts.query !== undefined) parts.query = opts.query;
  return {
    parts: n > 1 ? parts : {},
    questions: (at) => {
      const query = opts.query !== undefined ? at("query") : undefined;
      const list = at(name);
      const better = typeof opts.better === "function" ? opts.better(query) : (opts.better ?? q`more relevant to ${query}`);
      return Object.fromEntries(
        games.map(([id, a, b]) => {
          const ra = list.at(keys[a]!);
          const rb = list.at(keys[b]!);
          const text = opts.question ? opts.question(ra, rb, query) : q`Which is ${better}: ${ra} or ${rb}?`;
          return [id, choice(text, { [keys[a]!]: q`${ra}`, [keys[b]!]: q`${rb}` })];
        }),
      );
    },
    read: (answers) => {
      const duels: Duel[] = games.map(([id, a, b]) => {
        const r = readChoice(answers[id]);
        const pa = r.probabilities[keys[a]!] ?? 0;
        const pb = r.probabilities[keys[b]!] ?? 0;
        return { a, b, p: pa + pb > 0 ? pa / (pa + pb) : 0.5 };
      });
      return rankFromDuels(items, duels, { prior: opts.prior });
    },
  };
}

/**
 * Which of a pair is offered first when each pair is asked once: alternating by the pair's indices,
 * so in a full round robin every item goes first in about half its games.
 */
export function firstOf(a: number, b: number): number {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return (lo + hi) % 2 === 1 ? lo : hi;
}

/**
 * The ranking from a set of answered pairs: a Bradley–Terry fit over soft wins. `rankPairwise`
 * reads its answers with this; use it directly to re-rank from a subset of duels, or from duels
 * gathered some other way.
 */
export function rankFromDuels<T>(items: T[], duels: Duel[], opts: { prior?: number } = {}): PairwiseRanking<T> {
  const n = items.length;
  const keys = items.map((_, i) => `i${i + 1}`);
  const wins = items.map(() => new Array<number>(n).fill(0));
  const played = items.map(() => new Array<number>(n).fill(0));
  for (const { a, b, p } of duels) {
    wins[a]![b]! += p;
    wins[b]![a]! += 1 - p;
    played[a]![b]! += 1;
    played[b]![a]! += 1;
  }
  const strength = n > 1 ? bradleyTerry(wins, played, { prior: opts.prior }) : items.map(() => 0);
  const ranked: RankedItem<T>[] = items
    .map((item, index) => ({ item, index, key: keys[index]!, strength: strength[index]!, wins: wins[index]!.reduce((s, x) => s + x, 0), games: played[index]!.reduce((s, x) => s + x, 0) }))
    .sort((x, y) => y.strength - x.strength || x.index - y.index);
  ranked.forEach((r, i) => {
    const next = ranked[i + 1];
    if (next) r.beatsNext = beats(r.strength, next.strength);
  });
  // Pairs asked in both orders: how far apart the two answers are.
  const byPair = new Map<string, number[]>();
  for (const d of duels) {
    const [lo, hi] = d.a < d.b ? [d.a, d.b] : [d.b, d.a];
    byPair.set(`${lo},${hi}`, [...(byPair.get(`${lo},${hi}`) ?? []), d.a === lo ? d.p : 1 - d.p]);
  }
  const gaps = [...byPair.values()].filter((ps) => ps.length === 2).map(([x, y]) => Math.abs(x! - y!));
  const orderGap = gaps.length ? gaps.reduce((s, x) => s + x, 0) / gaps.length : undefined;
  return { ranked, confidence: ranked[0]?.beatsNext ?? 1, ...(orderGap !== undefined ? { orderGap } : {}), duels };
}
