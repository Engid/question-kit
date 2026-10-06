import type { Strategy } from "../types.ts";
import { headSelection } from "./head-selection/index.ts";
import { adjacentStrategy, rulesStrategy } from "./rules.ts";

/**
 * Every strategy the evals and the demo can run. Variants of head selection change one option at
 * a time against `head-selection`, so each comparison isolates one choice.
 */
export const STRATEGIES: Strategy[] = [
  headSelection("head-selection"),
  headSelection("head-selection:pos-hier", { pos: "hierarchical" }),
  headSelection("head-selection:single", { requests: "single" }),
  headSelection("head-selection:argmax", { decode: "argmax" }),
  headSelection("head-selection:pruned", { requests: "three-stage", prune: ["no-function-heads"] }),
  headSelection("head-selection:three-stage", { requests: "three-stage" }),
  headSelection("head-selection:both-orders", { order: "both" }),
  headSelection("head-selection:reversed", { order: "reversed" }),
  headSelection("head-selection:no-hints", { hints: "none" }),
  headSelection("head-selection:hints-v2", { hints: "v2" }),
  // Decode-time masks reuse their base strategy's requests, so they cost nothing on a cached sample.
  headSelection("head-selection:masked", { decodeMask: ["no-function-heads"] }),
  headSelection("head-selection:hints-v2-masked", { hints: "v2", decodeMask: ["no-function-heads"] }),
  headSelection("head-selection:masked-reattach", { decodeMask: ["no-function-heads"], reattachFunctionWords: true }),
  headSelection("head-selection:neighbors", { context: "neighbors" }),
  headSelection("head-selection:punct-shortcut", { punctShortcut: true }),
  rulesStrategy,
  adjacentStrategy,
];

export function getStrategy(name: string): Strategy {
  const s = STRATEGIES.find((x) => x.name === name);
  if (!s) throw new Error(`unknown strategy "${name}". Known: ${STRATEGIES.map((x) => x.name).join(", ")}`);
  return s;
}

/** Strategies that never call Jev. */
export const OFFLINE_STRATEGIES = new Set(["rules", "adjacent"]);
