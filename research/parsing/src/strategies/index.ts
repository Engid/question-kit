// Every strategy, in two lists:
//   LINEUP       what `bun run eval` and `bun run explain` show by default: the ladder (how much
//                Jev does) and the question-design strategies (how the questions are shaped)
//   EXPERIMENTS  one knob changed at a time, run with `--all` or by name
// A strategy is a recipe of Jev calls and code steps; see ladder.ts and phrases.ts.

import { finish } from "../result.ts";
import { type ParseInput, sentenceOf } from "../sentence.ts";
import type { Strategy } from "../types.ts";
import { attachStrategy, codeProposesJevPicks, jevOnly, jevWithCleanup, rules, rulesWithJevTypes } from "./ladder.ts";
import { jevPhrases, jevPhrasesPlusAttach, phraseStrategy } from "./phrases.ts";

export const LINEUP: Strategy[] = [rules, rulesWithJevTypes, codeProposesJevPicks, jevWithCleanup, jevOnly, jevPhrases, jevPhrasesPlusAttach];

const exp = { group: "experiment" as const };

export const EXPERIMENTS: Strategy[] = [
  // Variations on jev-only: one knob each.
  attachStrategy("jev-only/nested-types", { ...exp, summary: "Word type asked as 3 groups, then the type within the group, instead of one 17-option list." }, { wordTypes: "nested" }),
  attachStrategy("jev-only/one-call", { ...exp, summary: "Everything in one call; relationships are asked without knowing the attachment." }, { calls: "one" }),
  attachStrategy("jev-only/no-tree-builder", { ...exp, summary: "Each word takes Jev's top answer, without building a valid tree." }, { treeBuilder: false }),
  attachStrategy("jev-only/fewer-options", { ...exp, summary: "Word types first, then the attachment question leaves function words out of the options (3 calls)." }, { calls: "three" }),
  attachStrategy("jev-only/both-orders", { ...exp, summary: "The attachment question asked twice, options in both orders, answers averaged." }, { order: "both" }),
  attachStrategy("jev-only/reversed-order", { ...exp, summary: "The attachment options in reverse sentence order." }, { order: "reversed" }),
  attachStrategy("jev-only/no-hints", { ...exp, summary: "The attachment question without UD's conventions spelled out." }, { hints: "none" }),
  attachStrategy("jev-only/hints-v2", { ...exp, summary: "UD's conventions spelled out both ways (\"the noun attaches to …, never to the preposition\")." }, { hints: "v2" }),
  attachStrategy("jev-only/no-function-heads", { ...exp, summary: "Only the first cleanup rule: function words can't be heads." }, { noFunctionWordHeads: true }),
  attachStrategy("jev-only/neighbors-in-state", { ...exp, summary: "Each word in the state also carries its left and right neighbor." }, { wordsInState: "with-neighbors" }),
  // Variations on jev-phrases.
  phraseStrategy("jev-phrases/no-direction", "jev-phrases without the direction question.", { withDirection: false }, "experiment"),
  phraseStrategy("jev-phrases/no-second-look", "jev-phrases without the second-look call.", { secondLook: false }, "experiment"),
  // A trivial floor.
  {
    name: "adjacent",
    group: "baseline",
    summary: "No Jev, no rules: every word attaches to the next word.",
    async parse(input: ParseInput) {
      const s = sentenceOf(input);
      const n = s.words.length;
      return finish({ strategy: "adjacent", s, types: s.words.map(() => ({ type: "X" })), heads: [-1, ...s.words.map((_, i) => (i + 1 === n ? 0 : i + 2))] });
    },
  } satisfies Strategy,
];

export const ALL: Strategy[] = [...LINEUP, ...EXPERIMENTS];

export function getStrategy(name: string): Strategy {
  const s = ALL.find((x) => x.name === name);
  if (!s) throw new Error(`unknown strategy "${name}". Known: ${ALL.map((x) => x.name).join(", ")}`);
  return s;
}

/** Strategies that never call Jev. */
export function usesJev(s: Strategy): boolean {
  return s.name !== "rules" && s.name !== "adjacent";
}
