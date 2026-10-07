// Code rules applied after Jev's attachment answers (rung 3, "jev-with-cleanup"). They encode two
// of Universal Dependencies' conventions that Jev's answers broke most often in the first run:
// Jev tends to make the little function words heads, the way school grammar does.
//
// 1. Function words can't be heads. Using Jev's own word-type answers, determiners, prepositions,
//    conjunctions, particles, auxiliaries and punctuation are removed as possible attachment points
//    before the tree is built.
// 2. Re-attach introducing words. A preposition, subordinator or coordinator whose head lies to its
//    left, and which has a later sibling under that same head, moves onto the first such sibling:
//    "chased across the yard" with across → chased and yard → chased becomes across → yard.

export const FUNCTION_TYPES = new Set(["DET", "ADP", "CCONJ", "SCONJ", "PART", "AUX", "PUNCT"]);
const INTRODUCERS = new Set(["ADP", "SCONJ", "CCONJ"]);

/**
 * banned(head, word) for the tree builder. `types[id]` is the word type of word id (index 0
 * unused). A word keeps its full choice if banning would leave it only one option.
 */
export function functionWordsCantBeHeads(types: string[]): (head: number, word: number) => boolean {
  const n = types.length - 1;
  const banned = new Set<number>();
  for (let id = 1; id <= n; id++) if (FUNCTION_TYPES.has(types[id] as string)) banned.add(id);
  return (head, word) => {
    if (!banned.has(head)) return false;
    const kept = n + 1 - 1 - [...banned].filter((b) => b !== word).length; // heads 0..n, minus itself, minus banned
    return kept > 1 || n === 1;
  };
}

/** Rule 2. `heads[id]` is the head of word id (index 0 unused); returns a new array. */
export function reattachIntroducers(heads: number[], types: string[]): { heads: number[]; moved: [word: number, from: number, to: number][] } {
  const out = heads.slice();
  const n = heads.length - 1;
  const moved: [number, number, number][] = [];
  for (let f = 1; f <= n; f++) {
    if (!INTRODUCERS.has(types[f] as string)) continue;
    if (out.some((h, id) => id > 0 && h === f)) continue; // has dependents: leave it
    const h = out[f] as number;
    if (h > f) continue; // already attached to something on its right
    for (let j = f + 1; j <= n; j++) {
      const t = types[j] as string;
      if (out[j] === h && t !== "PUNCT" && !INTRODUCERS.has(t)) {
        out[f] = j;
        moved.push([f, h, j]);
        break;
      }
    }
  }
  return { heads: out, moved };
}
