// Confidence and composition helpers. Each formula cites the TypeSafe page it comes from.

const EPSILON = 1e-9;

/**
 * Choice confidence: how far the top probability sits above an even split.
 * (p_max − 1/n) / (1 − 1/n). https://docs.typesafe.ai/confidence.md
 */
export function choiceConfidence(probabilities: Record<string, number>): number {
  const ps = Object.values(probabilities);
  const n = ps.length;
  if (n < 2) return 1;
  const pMax = Math.max(...ps);
  return Math.max(0, (pMax - 1 / n) / (1 - 1 / n));
}

/** Noul confidence: |2p − 1|. https://docs.typesafe.ai/confidence.md */
export function noulConfidence(p: number): number {
  return Math.abs(2 * p - 1);
}

/**
 * Separation ratio: top score / second score. Near 1 means ambiguous.
 * https://docs.typesafe.ai/cookbooks/hierarchical_classification.md
 */
export function separation(scores: Iterable<number>): number {
  let top = 0;
  let second = 0;
  for (const s of scores) {
    if (s > top) {
      second = top;
      top = s;
    } else if (s > second) {
      second = s;
    }
  }
  return top / Math.max(second, EPSILON);
}

/**
 * Path score for a leaf reached through a sequence of Choice decisions: the geometric mean of the
 * edge probabilities. This is TypeSafe's published rule for trees whose branches at each node are
 * the options of one Choice. https://docs.typesafe.ai/cookbooks/hierarchical_classification.md
 */
export function pathScore(edgeProbabilities: number[]): number {
  if (edgeProbabilities.length === 0) return 0;
  let logSum = 0;
  for (const p of edgeProbabilities) logSum += Math.log(Math.max(p, EPSILON));
  return Math.exp(logSum / edgeProbabilities.length);
}

export interface TwoLevelResult {
  /** Leaf with the highest path score. */
  best: string;
  /** Path score (geometric mean) of every leaf. */
  pathScores: Record<string, number>;
  /** p(group) × p(leaf | group), which sums to 1 over the leaves: a distribution for display. */
  distribution: Record<string, number>;
  /** Best path score / second-best path score. */
  separation: number;
}

/**
 * Combine a coarse Choice (group) with one fine Choice per group into scores over the leaves.
 * Every leaf sits at depth 2, so ranking by path score and by product agree; both are returned.
 */
export function composeTwoLevel(
  groupProbs: Record<string, number>,
  fineProbs: Record<string, Record<string, number>>,
): TwoLevelResult {
  const pathScores: Record<string, number> = {};
  const distribution: Record<string, number> = {};
  for (const [group, pg] of Object.entries(groupProbs)) {
    const fine = fineProbs[group];
    if (!fine) continue;
    for (const [leaf, pf] of Object.entries(fine)) {
      pathScores[leaf] = pathScore([pg, pf]);
      distribution[leaf] = pg * pf;
    }
  }
  let best = "";
  let bestScore = -1;
  for (const [leaf, s] of Object.entries(pathScores)) {
    if (s > bestScore) {
      bestScore = s;
      best = leaf;
    }
  }
  return { best, pathScores, distribution, separation: separation(Object.values(pathScores)) };
}

export function argmax(probabilities: Record<string, number>): string {
  let best = "";
  let bestP = -1;
  for (const [k, p] of Object.entries(probabilities)) {
    if (p > bestP) {
      bestP = p;
      best = k;
    }
  }
  return best;
}
