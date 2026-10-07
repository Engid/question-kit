// An order taker built on Jev, for any menu: code reads what the menu knows, Jev reads the rest and
// checks the result. See README.md in this folder.

export { ask, type Answer, type Entry, type JevCall, type JevClient, type JevRequest, type JevResponse, type Question } from "./jev.ts";
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
export { checkQuestions, pickQuestion, readBackLines, readBackOrder, wordTagOptions, wordTagQuestions } from "./questions.ts";
export { assemble, menuTags, type Tag, tokenize } from "./rules.ts";
export { type Design, type OrderCheck, type OrderResult, takeOrder, type TakeOrderOptions, type WordReading } from "./take-order.ts";
