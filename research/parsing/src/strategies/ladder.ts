// The ladder: the same parsing problem with Jev doing more and more of the work.
//
//   dial 0  rules                    code only
//   dial 1  rules-with-jev-types     Jev says what kind of word each word is; code attaches
//   dial 2  code-proposes-jev-picks  code proposes a few candidate heads per word; Jev picks
//   dial 3  jev-with-cleanup         Jev picks from every word; two code rules apply UD conventions
//   dial 4  jev-only                 Jev picks from every word; code only makes it a valid tree
//
// Each strategy below is a short function you can read top to bottom: the Jev calls, and the code
// between them.

import { CallLog } from "../../../lab/calls.ts";
import { functionWordsCantBeHeads, FUNCTION_TYPES, reattachIntroducers } from "../code-rules/cleanup.ts";
import { proposeCandidates, ruleParse, ruleTag } from "../code-rules/rule-parser.ts";
import type { JevClient } from "../../../lab/jev/types.ts";
import * as attachTo from "../question-sets/attach-to.ts";
import * as relationship from "../question-sets/relationship.ts";
import * as wordType from "../question-sets/word-type.ts";
import { finish } from "../result.ts";
import { type ParseInput, range, sentenceOf, stateOf, type WordsInState } from "../sentence.ts";
import type { ParseResult, Strategy } from "../types.ts";
import { buildTree, HeadVotes } from "../votes.ts";

// ------------------------------------------------------------------ dial 0: rules

export const rules: Strategy = {
  name: "rules",
  rung: 0,
  group: "ladder",
  summary: "Code only: a small word list tags each word, and rules attach it to the nearest plausible word.",
  async parse(input) {
    const s = sentenceOf(input);
    const tags = ruleTag(s.words);
    const { heads, deprels } = ruleParse(s.words, tags);
    return finish({
      strategy: "rules",
      s,
      types: tags.map((type) => ({ type })),
      heads: [-1, ...heads],
      relationship: (d) => deprels[d - 1],
    });
  },
};

// ------------------------------------------------------------------ dial 1: rules + Jev word types

export const rulesWithJevTypes: Strategy = {
  name: "rules-with-jev-types",
  rung: 1,
  group: "ladder",
  summary: "Jev says what kind of word each word is (1 call); the same rules as rung 0 do the attaching.",
  async parse(input, jev) {
    const s = sentenceOf(input);
    const log = new CallLog(jev);
    // Call 1: what kind of word is each word?
    const answers = await log.call("word types", stateOf(s), wordType.ask(s));
    const types = wordType.read(s, answers);
    // Code: attach by rules, using Jev's word types.
    const { heads, deprels } = ruleParse(s.words, types.map((t) => t.type));
    log.note("Rules attached every word, using Jev's word types instead of the word list.");
    return finish({ strategy: "rules-with-jev-types", s, log, types, heads: [-1, ...heads], relationship: (d) => deprels[d - 1] });
  },
};

// ------------------------------------------------------------------ dial 2: code proposes, Jev picks

export const codeProposesJevPicks = codeProposes(true);

function codeProposes(labels: boolean): Strategy {
  return {
    name: "code-proposes-jev-picks",
    rung: 2,
    group: "ladder",
    summary:
      "Jev gives word types; rules propose about 6 candidate heads per word; Jev picks one (TypeSafe's \"code finds candidates, the model picks\" pattern); Jev names the relationships.",
    unlabeled: () => codeProposes(false),
    async parse(input, jev) {
      const s = sentenceOf(input);
      const log = new CallLog(jev);
      // Call 1: what kind of word is each word?
      const types = wordType.read(s, await log.call("word types", stateOf(s), wordType.ask(s)));
      // Code: the rules' own attachment, plus nearby content words and verbs, become the candidates.
      const tags = types.map((t) => t.type);
      const { heads: ruleHeads } = ruleParse(s.words, tags);
      const candidates = proposeCandidates(tags, ruleHeads);
      log.note(`Code proposed ${candidates.reduce((a, c) => a + c.length, 0)} candidate heads (${(candidates.reduce((a, c) => a + c.length, 0) / s.words.length).toFixed(1)} per word).`);
      // Call 2: which candidate does each word attach to?
      const answers = await log.call("pick among candidates", stateOf(s), attachTo.ask(s, { candidates: (d) => candidates[d - 1] ?? [] }));
      const votes = new HeadVotes(s.words.length);
      for (const [d, dist] of attachTo.read(s, answers)) votes.add(attachTo.ID, d, dist);
      // Code: best valid tree.
      const heads = buildTree(votes);
      noteTree(log, votes, heads);
      // Call 3: name each relationship.
      const rel = labels ? await log.call("relationships", stateOf(s), relationship.ask(s, linksOf(heads))) : undefined;
      return finish({ strategy: "code-proposes-jev-picks", s, log, types, heads, votes, relationship: (d) => (rel ? relationship.read(rel, d) : undefined) });
    },
  };
}

// ------------------------------------------------------------------ dials 3 and 4: Jev picks from every word

export interface AttachOptions {
  /** Word type as one 17-option question, or nested (3 groups, then the type). */
  wordTypes?: wordType.Shape;
  /** Option order in the attachment question. */
  order?: attachTo.Order;
  /** How much of UD's convention to spell out in the question. */
  hints?: attachTo.Hints;
  /** What each word looks like in the state. */
  wordsInState?: WordsInState;
  /**
   * How to split the work into calls:
   *   two:   word types + attachments, then relationships (default)
   *   one:   everything in one call; relationships asked without knowing the attachment
   *   three: word types first, then attachments with function words left out of the options,
   *          then relationships
   */
  calls?: "two" | "one" | "three";
  /** Build a valid tree from the votes (default), or just take each word's top answer. */
  treeBuilder?: boolean;
  /** Code rule: function words can't be heads (uses Jev's word types). */
  noFunctionWordHeads?: boolean;
  /** Code rule: move prepositions/subordinators/conjunctions onto the word they introduce. */
  reattachIntroducers?: boolean;
  /** Ask the relationship questions (off for attachment-only runs). */
  labels?: boolean;
}

export function attachStrategy(
  name: string,
  meta: Pick<Strategy, "group" | "summary" | "rung">,
  o: AttachOptions = {},
): Strategy & { options: AttachOptions } {
  return {
    name,
    ...meta,
    options: o,
    parse: (input, jev) => parseAttach(name, input, jev, o),
    unlabeled: () => attachStrategy(name, meta, { ...o, labels: false }),
  };
}

async function parseAttach(name: string, input: ParseInput, jev: JevClient, o: AttachOptions): Promise<ParseResult> {
  const s = sentenceOf(input);
  const n = s.words.length;
  const log = new CallLog(jev);
  const state = stateOf(s, {}, o.wordsInState ?? "plain");
  const shape = o.wordTypes ?? "flat";
  const ask = { order: o.order ?? "sentence", hints: o.hints ?? "v1" } as const;
  const labels = o.labels ?? true;

  let types: wordType.WordType[];
  let attach: ReturnType<typeof attachTo.read>;
  let oneCallAnswers: Awaited<ReturnType<CallLog["call"]>> | undefined;

  if (o.calls === "one") {
    // Call 1: everything at once. The relationship questions can't name the head yet.
    const all = await log.call(
      "everything at once",
      state,
      wordType.ask(s, shape),
      attachTo.ask(s, ask),
      labels ? relationship.ask(s, range(1, n).map((d) => [d, undefined])) : {},
    );
    types = wordType.read(s, all, shape);
    attach = attachTo.read(s, all);
    oneCallAnswers = all;
  } else if (o.calls === "three") {
    // Call 1: word types. Call 2: attachments, offering only content words (and root).
    types = wordType.read(s, await log.call("word types", state, wordType.ask(s, shape)), shape);
    const banned = functionWordsCantBeHeads([-1, ...types.map((t) => t.type)].map(String));
    const candidates = (d: number) => range(0, n).filter((h) => h !== d && !banned(h, d));
    log.note(`Code left function words (${[...FUNCTION_TYPES].join(", ")}, by Jev's word types) out of the attachment options.`);
    attach = attachTo.read(s, await log.call("attachments", state, attachTo.ask(s, { ...ask, candidates })));
  } else {
    // Call 1: what kind of word is each word, and which word does it attach to?
    const answers = await log.call("word types + attachments", state, wordType.ask(s, shape), attachTo.ask(s, ask));
    types = wordType.read(s, answers, shape);
    attach = attachTo.read(s, answers);
  }

  const votes = new HeadVotes(n);
  for (const [d, dist] of attach) votes.add(attachTo.ID, d, dist);

  // Code: optional cleanup rule 1, then the tree builder (or each word's top answer).
  const typeById = ["", ...types.map((t) => t.type)];
  const banned = o.noFunctionWordHeads ? functionWordsCantBeHeads(typeById) : undefined;
  if (banned) log.note(`Cleanup: function words (${[...FUNCTION_TYPES].join(", ")}, by Jev's word types) can't be heads.`);
  let heads: number[];
  if (o.treeBuilder === false) {
    heads = votes.topHeads();
    log.note("No tree builder: each word takes Jev's top answer, even if that makes a loop.");
  } else {
    heads = buildTree(votes, banned);
    noteTree(log, votes, heads);
  }
  // Code: optional cleanup rule 2.
  const cleaned = new Set<number>();
  if (o.reattachIntroducers) {
    const r = reattachIntroducers(heads, typeById);
    heads = r.heads;
    for (const [w, from, to] of r.moved) {
      cleaned.add(w);
      log.note(`Cleanup: moved "${s.words[w - 1]}" from "${s.words[from - 1] ?? "root"}" to "${s.words[to - 1]}", the word it introduces.`);
    }
  }

  // Call 2: name each relationship (already asked in "one" mode).
  let relAnswers = oneCallAnswers;
  if (labels && !relAnswers) relAnswers = await log.call("relationships", state, relationship.ask(s, linksOf(heads)));
  return finish({
    strategy: name,
    s,
    log,
    types,
    heads,
    votes,
    cleaned,
    relationship: (d) => (relAnswers ? relationship.read(relAnswers, d) : undefined),
  });
}

export const jevWithCleanup = attachStrategy(
  "jev-with-cleanup",
  { rung: 3, group: "ladder", summary: "Same calls as jev-only, plus two code rules for UD conventions: function words can't be heads, and prepositions/conjunctions move onto the word they introduce." },
  { noFunctionWordHeads: true, reattachIntroducers: true },
);

export const jevOnly = attachStrategy("jev-only", {
  rung: 4,
  group: "ladder",
  summary: "Jev gives word types and picks each word's head from every word in one call, then names the relationships; code only builds a valid tree.",
});

// ------------------------------------------------------------------ helpers

/** [word, head] for every word, from heads[id]. */
export function linksOf(heads: number[]): [number, number][] {
  return heads.slice(1).map((h, i) => [i + 1, h]);
}

export function noteTree(log: CallLog, votes: HeadVotes, heads: number[]): void {
  const top = votes.topHeads();
  const changed = heads.filter((h, d) => d > 0 && h !== top[d]).length;
  log.note(
    changed === 0
      ? "Tree builder: Jev's top answers already formed a valid tree."
      : `Tree builder: ${changed} word${changed === 1 ? "" : "s"} got a different head than Jev's top answer, to make a valid tree with one main word.`,
  );
}
