// An order taker built on Jev, for any menu: code reads what the menu knows, Jev reads the rest and
// checks the result. Built on question-kit's tasks: `choose` for the words and the pick, `check` for
// the read-back, `runAll` to send each set together. See README.md in this folder.

export type { Answer, Entry, Question, SystemOneCall, SystemOneClient, SystemOneRequest, SystemOneResponse } from "../core/index.ts";
export {
  DEFAULT_AMOUNTS,
  DEFAULT_NUMBERS,
  DEFAULT_WORDS,
  defineMenu,
  type Field,
  type FieldInput,
  type Kind,
  type KindInput,
  type Menu,
  type MenuInput,
  type MenuValue,
  type ReadBack,
  type ValueInput,
} from "./menu.ts";
export { type Choice, defaultReadBack, type OrderItem, plural, sameItems } from "./order.ts";
export { type About, type Asked, checkState, orderChecks, pickOrder, pickState, pickSwap, readBackLines, readBackOrder, wordsState, wordTag, wordTagOptions, wordTags } from "./questions.ts";
export { assemble, type AssembleOptions, menuTags, type Tag, tokenize } from "./rules.ts";
export { type Design, type OrderCheck, type OrderResult, takeOrder, type TakeOrderOptions, type WordReading } from "./take-order.ts";
