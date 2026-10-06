// Question design: find small phrases first, then attach whole phrases.
//
//   call 1  word types + neighbor links + direction       (everything that can be asked at once)
//   code    cut the sentence into phrases where Jev said "not the same phrase"
//   call 2  inside each phrase: which word does each word attach to?
//           between phrases: which phrase does each phrase attach to?
//   code    combine all the votes and build the best tree
//   call 3  second look: for words with two close candidates, choose between just those two,
//           asked in both orders
//   code    rebuild the tree with the new votes
//   call 4  name each relationship
//
// The idea: every question stays small (a yes/no, or a Choice over a handful of options), and the
// big "which of all 40 words?" question is replaced by "which of these 8 phrases?".

import { CallLog } from "../calls.ts";
import type { JevClient } from "../jev/types.ts";
import * as attachTo from "../question-sets/attach-to.ts";
import * as direction from "../question-sets/direction.ts";
import * as neighborLinks from "../question-sets/neighbor-links.ts";
import * as phrasesQ from "../question-sets/phrase-attach.ts";
import * as relationship from "../question-sets/relationship.ts";
import * as secondLook from "../question-sets/second-look.ts";
import * as wordType from "../question-sets/word-type.ts";
import { finish } from "../result.ts";
import { type ParseInput, sentenceOf, stateOf } from "../sentence.ts";
import type { ParseResult, Strategy } from "../types.ts";
import { buildTree, HeadVotes } from "../votes.ts";
import { linksOf, noteTree } from "./ladder.ts";

export interface PhraseOptions {
  /** Also ask the big attach-to question in call 1, as one more vote. */
  withAttachTo?: boolean;
  /** Ask the direction question in call 1 (default on). */
  withDirection?: boolean;
  /** Ask the second-look questions (default on). */
  secondLook?: boolean;
  /** Second look for words whose top two candidates are within this ratio. */
  secondLookRatio?: number;
  /** Ask the relationship questions (off for attachment-only runs). */
  labels?: boolean;
}

export function phraseStrategy(
  name: string,
  summary: string,
  o: PhraseOptions = {},
  group: Strategy["group"] = "question-design",
): Strategy & { options: PhraseOptions } {
  return {
    name,
    group,
    summary,
    options: o,
    parse: (input, jev) => parsePhrases(name, input, jev, o),
    unlabeled: () => phraseStrategy(name, summary, { ...o, labels: false }, group),
  };
}

async function parsePhrases(name: string, input: ParseInput, jev: JevClient, o: PhraseOptions): Promise<ParseResult> {
  const s = sentenceOf(input);
  const n = s.words.length;
  const log = new CallLog(jev);

  // Call 1: everything that doesn't depend on anything else.
  const a1 = await log.call(
    o.withAttachTo ? "word types + neighbor links + direction + attachments" : "word types + neighbor links + direction",
    stateOf(s),
    wordType.ask(s),
    neighborLinks.ask(s),
    o.withDirection === false ? {} : direction.ask(s),
    o.withAttachTo ? attachTo.ask(s) : {},
  );
  const types = wordType.read(s, a1);
  const votes = new HeadVotes(n);
  if (o.withDirection !== false) for (const [d, dist] of direction.read(s, a1)) votes.add(direction.ID, d, dist);
  if (o.withAttachTo) for (const [d, dist] of attachTo.read(s, a1)) votes.add(attachTo.ID, d, dist);

  // Code: cut into phrases where Jev said the neighbors are not in the same phrase.
  const phrases = neighborLinks.phrasesFrom(n, neighborLinks.read(s, a1));
  log.note(`Phrases from the neighbor links: ${phrases.map((p) => `[${phrasesQ.phraseText(s, p)}]`).join(" ")}`);

  // Call 2: inside each phrase, and between phrases.
  const a2 = await log.call("inside and between phrases", stateOf(s, phrasesQ.phraseState(s, phrases)), phrasesQ.ask(s, phrases));
  const reading = phrasesQ.read(s, phrases, a2);
  for (const [d, dist] of reading.votes) votes.add("phrases", d, dist);
  log.note(`Main word of each phrase (most likely to attach outside it): ${reading.mainWords.map((w) => `"${s.words[w - 1]}"`).join(", ")}`);

  // Code: combine the votes and build the best tree.
  let heads = buildTree(votes);
  noteTree(log, votes, heads);

  // Call 3: second look at close calls.
  if (o.secondLook !== false) {
    const close = secondLook.closeCalls(votes, o.secondLookRatio ?? 3);
    if (close.length > 0) {
      const a3 = await log.call("second look", stateOf(s), secondLook.ask(s, close));
      for (const [d, dist] of secondLook.read(a3, close)) votes.add(secondLook.ID, d, dist);
      heads = buildTree(votes);
      log.note(`Second look at ${close.length} close call${close.length === 1 ? "" : "s"}; rebuilt the tree with those votes.`);
    } else {
      log.note("No close calls, so no second look.");
    }
  }

  // Call 4: name each relationship.
  const rel = o.labels === false ? undefined : await log.call("relationships", stateOf(s), relationship.ask(s, linksOf(heads)));
  return finish({ strategy: name, s, log, types, heads, votes, relationship: (d) => (rel ? relationship.read(rel, d) : undefined) });
}

export const jevPhrases = phraseStrategy(
  "jev-phrases",
  "Small questions only: neighbor links make phrases, then Jev attaches words inside phrases and phrases to phrases, takes a second look at close calls, and names relationships (4 calls).",
);

export const jevPhrasesPlusAttach = phraseStrategy(
  "jev-phrases-plus-attach",
  "jev-phrases, plus jev-only's big \"which word does it attach to?\" question in call 1 as one more vote.",
  { withAttachTo: true },
);
