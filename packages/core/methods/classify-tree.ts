// classifyTree: walk a hierarchy of labels from the top, keeping the best few paths.
//
// One Choice per node over its direct children. Instead of committing to the best child at each
// level (where one early mistake can't be undone), it keeps the `beam` best paths. A path's score
// is the geometric mean of its choices' probabilities, so shallow and deep leaves compare fairly.
// All of a round's questions share the text, so each round is one request.
// Based on the approach in TypeSafe's "Hierarchical classification" cookbook.

import type { JevCall, JevClient } from "../jev.ts";
import { choice } from "../questions.ts";
import { readChoice } from "../readings.ts";
import { q, type Text } from "../state.ts";
import { place, run } from "../task.ts";

/** A label tree: each node's children by id. A node's description is `what`. */
export interface TreeNode {
  what?: string;
  children?: Record<string, TreeNode>;
}

export interface ClassifyTreeOptions {
  beam?: number;
  maxDepth?: number;
  name?: string;
  log?: JevCall[];
}

export interface TreePath {
  path: string[];
  score: number;
}

export interface TreeResult {
  /** The best path, from the top level down. */
  path: string[];
  score: number;
  /** The best paths found, best first. */
  beam: TreePath[];
  /** Best score / second-best score; near 1 means it's close between two paths. */
  separation: number;
}

interface Partial {
  path: string[];
  node: TreeNode;
  logSum: number;
  decisions: number;
}

const EPSILON = 1e-9;

export async function classifyTree(jev: JevClient, text: Text, tree: TreeNode, opts: ClassifyTreeOptions = {}): Promise<TreeResult> {
  const width = opts.beam ?? 3;
  const maxDepth = opts.maxDepth ?? 12;
  const t = place(text, opts.name ?? "text");
  let beam: Partial[] = [{ path: [], node: tree, logSum: 0, decisions: 0 }];
  const scoreOf = (p: Partial) => (p.decisions ? Math.exp(p.logSum / p.decisions) : 1);

  for (let depth = 0; depth < maxDepth; depth++) {
    const open = beam.filter((p) => p.node.children && Object.keys(p.node.children).length > 0);
    if (!open.length) break;
    // Nodes with a single child need no question.
    const asking = open.filter((p) => Object.keys(p.node.children!).length > 1);
    const answers = asking.length
      ? await run(
          jev,
          {
            parts: t.parts,
            questions: (at) =>
              Object.fromEntries(
                asking.map((p, i) => [
                  `node${i}`,
                  choice(
                    p.path.length ? q`Which of these subcategories of "${p.path.join(" > ")}" best matches ${t.ref(at)}?` : q`Which of these categories best matches ${t.ref(at)}?`,
                    Object.fromEntries(Object.entries(p.node.children!).map(([id, c]) => [id, c.what ?? null])),
                  ),
                ]),
              ),
            read: (a) => asking.map((_, i) => readChoice(a[`node${i}`]).probabilities),
          },
          { log: opts.log, title: `classifyTree: depth ${depth + 1}` },
        )
      : [];
    const next: Partial[] = beam.filter((p) => !p.node.children || Object.keys(p.node.children).length === 0);
    for (const p of open) {
      const kids = Object.entries(p.node.children!);
      if (kids.length === 1) {
        const [id, c] = kids[0]!;
        next.push({ path: [...p.path, id], node: c, logSum: p.logSum, decisions: p.decisions });
        continue;
      }
      const probs = answers[asking.indexOf(p)]!;
      for (const [id, c] of kids) next.push({ path: [...p.path, id], node: c, logSum: p.logSum + Math.log(Math.max(probs[id] ?? 0, EPSILON)), decisions: p.decisions + 1 });
    }
    beam = next.sort((x, y) => scoreOf(y) - scoreOf(x)).slice(0, width);
  }
  const ranked = beam.map((p) => ({ path: p.path, score: scoreOf(p) }));
  const best = ranked[0] ?? { path: [], score: 0 };
  const second = ranked[1]?.score ?? 0;
  return { path: best.path, score: best.score, beam: ranked, separation: best.score / Math.max(second, EPSILON) };
}
