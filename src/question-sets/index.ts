// Every question set, by id: its plain-English title and how to check an answer against the
// treebank. Used by `bun run explain`, the eval's report card and the gold-tree oracle.

import type { QuestionMeta } from "../calls.ts";
import type { Gold } from "../gold.ts";
import * as attachTo from "./attach-to.ts";
import * as direction from "./direction.ts";
import * as neighborLinks from "./neighbor-links.ts";
import * as phrases from "./phrase-attach.ts";
import * as relationship from "./relationship.ts";
import * as secondLook from "./second-look.ts";
import * as wordType from "./word-type.ts";

export interface QuestionSetInfo {
  id: string;
  title: string;
  /** The right answer per the treebank: an option id (Choice) or yes/no (Noul); undefined if none applies. */
  expected(meta: QuestionMeta, gold: Gold): string | boolean | undefined;
}

export const QUESTION_SETS: Record<string, QuestionSetInfo> = Object.fromEntries(
  [
    { id: wordType.ID, title: wordType.TITLE, expected: wordType.expected },
    { id: attachTo.ID, title: attachTo.TITLE, expected: attachTo.expected },
    { id: neighborLinks.ID, title: neighborLinks.TITLE, expected: neighborLinks.expected },
    { id: direction.ID, title: direction.TITLE, expected: direction.expected },
    { id: phrases.ID_INSIDE, title: phrases.TITLE_INSIDE, expected: phrases.expectedInside },
    { id: phrases.ID_BETWEEN, title: phrases.TITLE_BETWEEN, expected: phrases.expectedBetween },
    { id: secondLook.ID, title: secondLook.TITLE, expected: secondLook.expected },
    { id: relationship.ID, title: relationship.TITLE, expected: relationship.expected },
  ].map((q) => [q.id, q]),
);
