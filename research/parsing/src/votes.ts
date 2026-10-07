// Votes on "which word does each word attach to", and the tree builder that turns them into a tree.
//
// Each question set that has an opinion about attachments adds, for each word, a probability for
// every possible head (0 = root). The votes are combined by adding their logs (multiplying the
// probabilities), and the tree builder picks the highest-scoring set of attachments that forms a
// valid tree with exactly one main word (Chu-Liu/Edmonds; see src/decode/cle.ts).

import { decodeSingleRoot, NEG } from "./decode/cle.ts";

/** Probability per head id, for one word. Heads left out count as probability 0. */
export type HeadDist = Record<number, number>;

/** Floor for probabilities before taking logs, so one vote of 0 doesn't forbid an attachment outright. */
const EPS = 1e-6;

export class HeadVotes {
  /** byWord[d][set] = that set's distribution over heads for word d. */
  readonly byWord: Map<string, HeadDist>[];

  constructor(readonly n: number) {
    this.byWord = Array.from({ length: n + 1 }, () => new Map());
  }

  add(set: string, word: number, dist: HeadDist): void {
    this.byWord[word]?.set(set, dist);
  }

  /** Sets that voted on any word. */
  sets(): string[] {
    return [...new Set(this.byWord.flatMap((m) => [...m.keys()]))];
  }

  /**
   * Combined score of attaching `word` to `head`: the sum of log probabilities over the sets that
   * voted on this word. Returns undefined when no set voted on the word.
   */
  score(head: number, word: number): number | undefined {
    const votes = this.byWord[word];
    if (!votes || votes.size === 0) return undefined;
    let total = 0;
    for (const dist of votes.values()) total += Math.log(Math.max(dist[head] ?? 0, EPS));
    return total;
  }

  /** The combined votes for one word, normalized to sum to 1 over its possible heads. */
  combined(word: number): HeadDist {
    const out: HeadDist = {};
    let max = -Infinity;
    for (let h = 0; h <= this.n; h++) {
      if (h === word) continue;
      const s = this.score(h, word);
      if (s === undefined) continue;
      out[h] = s;
      max = Math.max(max, s);
    }
    let z = 0;
    for (const h of Object.keys(out)) {
      out[Number(h)] = Math.exp((out[Number(h)] as number) - max);
      z += out[Number(h)] as number;
    }
    for (const h of Object.keys(out)) out[Number(h)] = (out[Number(h)] as number) / z;
    return out;
  }

  /** The combined top head for each word (index 0 unused). */
  topHeads(): number[] {
    const out = [-1];
    for (let d = 1; d <= this.n; d++) {
      const c = this.combined(d);
      let best = 0;
      let bestP = -1;
      for (const [h, p] of Object.entries(c)) {
        if (p > bestP) {
          bestP = p;
          best = Number(h);
        }
      }
      out.push(best);
    }
    return out;
  }
}

/**
 * The tree builder: the best-scoring tree with exactly one main word. `banned(h, d)` removes an
 * attachment entirely (used by code rules such as "function words can't be heads").
 * Returns heads[d] for d = 1..n (index 0 is -1).
 */
export function buildTree(votes: HeadVotes, banned?: (head: number, word: number) => boolean): number[] {
  const n = votes.n;
  const scores: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(n + 1).fill(NEG));
  for (let d = 1; d <= n; d++) {
    for (let h = 0; h <= n; h++) {
      if (h === d || banned?.(h, d)) continue;
      const s = votes.score(h, d);
      if (s !== undefined) (scores[h] as number[])[d] = s;
    }
  }
  return decodeSingleRoot(scores).heads;
}
