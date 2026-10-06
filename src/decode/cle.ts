// Chu-Liu/Edmonds maximum spanning arborescence, as used for graph-based dependency parsing by
// McDonald, Pereira, Ribarov & Hajič (2005), "Non-Projective Dependency Parsing using Spanning
// Tree Algorithms" (HLT-EMNLP). Node 0 is the artificial root.
//
// `scores[h][d]` is the score of attaching dependent d to head h (higher is better). Use log
// probabilities so that a tree's score is the log of the product of its edge probabilities.

/** Forbidden edges. Finite, so arithmetic on it never produces NaN. */
export const NEG = -1e9;

/** Returns heads[d] for every node; heads[0] is -1. Allows several words to attach to the root. */
export function chuLiuEdmonds(scores: number[][]): number[] {
  const n = scores.length;
  const s = (h: number, d: number) => (scores[h] as number[])[d] as number;

  // 1. Every non-root node takes its best incoming edge.
  const heads = new Array<number>(n).fill(-1);
  for (let d = 1; d < n; d++) {
    let best = d === 0 ? 1 : 0;
    for (let h = 0; h < n; h++) {
      if (h !== d && s(h, d) > s(best, d)) best = h;
    }
    heads[d] = best;
  }

  // 2. If that's a tree, done.
  const cycle = findCycle(heads);
  if (!cycle) return heads;

  // 3. Contract the cycle into one node and solve the smaller problem.
  const inCycle = new Set(cycle);
  const rest: number[] = [];
  for (let v = 0; v < n; v++) if (!inCycle.has(v)) rest.push(v); // rest[0] is the root
  const c = rest.length; // index of the contracted node
  const m = c + 1;
  const sub: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(NEG));
  const enterAt = new Array<number>(m).fill(-1); // for u → cycle: which cycle node is entered
  const leaveFrom = new Array<number>(m).fill(-1); // for cycle → w: which cycle node is the head

  for (let i = 0; i < c; i++) {
    const u = rest[i] as number;
    for (let j = 1; j < c; j++) {
      if (i !== j) (sub[i] as number[])[j] = s(u, rest[j] as number);
    }
    // Entering the cycle at v replaces v's in-cycle edge.
    let bestV = -1;
    let best = -Infinity;
    for (const v of cycle) {
      const gain = s(u, v) - s(heads[v] as number, v);
      if (gain > best) {
        best = gain;
        bestV = v;
      }
    }
    (sub[i] as number[])[c] = best;
    enterAt[i] = bestV;
  }
  for (let j = 1; j < c; j++) {
    const w = rest[j] as number;
    let bestV = -1;
    let best = -Infinity;
    for (const v of cycle) {
      if (s(v, w) > best) {
        best = s(v, w);
        bestV = v;
      }
    }
    (sub[c] as number[])[j] = best;
    leaveFrom[j] = bestV;
  }

  const subHeads = chuLiuEdmonds(sub);

  // 4. Expand: cycle nodes keep their in-cycle heads except where the cycle is entered.
  const out = heads.slice();
  for (let j = 1; j < c; j++) {
    const hj = subHeads[j] as number;
    out[rest[j] as number] = hj === c ? (leaveFrom[j] as number) : (rest[hj] as number);
  }
  const entry = subHeads[c] as number;
  out[enterAt[entry] as number] = rest[entry] as number;
  return out;
}

/** A cycle in a head array (as a list of nodes), or undefined if every node reaches the root. */
export function findCycle(heads: number[]): number[] | undefined {
  const n = heads.length;
  const state = new Array<number>(n).fill(0); // 0 unvisited, 1 on current path, 2 done
  state[0] = 2;
  for (let start = 1; start < n; start++) {
    if (state[start] !== 0) continue;
    const path: number[] = [];
    let v = start;
    while (state[v] === 0) {
      state[v] = 1;
      path.push(v);
      v = heads[v] as number;
      if (v < 0) break;
    }
    if (v >= 0 && state[v] === 1) return path.slice(path.indexOf(v));
    for (const p of path) state[p] = 2;
  }
  return undefined;
}

export function treeScore(scores: number[][], heads: number[]): number {
  let total = 0;
  for (let d = 1; d < heads.length; d++) total += (scores[heads[d] as number] as number[])[d] as number;
  return total;
}

/**
 * The best tree in which exactly one word attaches to the root, as UD requires. Tries the
 * unconstrained tree first; if it has several root children, tries each word as the only root
 * child and keeps the best (n extra decodes, fine at sentence lengths).
 */
export function decodeSingleRoot(scores: number[][]): { heads: number[]; score: number } {
  const n = scores.length;
  const free = chuLiuEdmonds(scores);
  if (free.filter((h, d) => d > 0 && h === 0).length === 1) return { heads: free, score: treeScore(scores, free) };

  let bestHeads = free;
  let bestScore = -Infinity;
  for (let r = 1; r < n; r++) {
    const constrained = scores.map((row, h) => (h === 0 ? row.map((v, d) => (d === r ? v : NEG)) : row));
    const heads = chuLiuEdmonds(constrained);
    const score = treeScore(scores, heads);
    if (score > bestScore) {
      bestScore = score;
      bestHeads = heads;
    }
  }
  return { heads: bestHeads, score: bestScore };
}
