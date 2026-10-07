// A pizza order taker built on Jev: code reads what the menu knows, Jev reads the rest and checks
// the result. See README.md in this folder.

export { ask, type Answer, type Entry, type JevCall, type JevClient, type JevRequest, type JevResponse, type Question } from "./jev.ts";
export { DEFAULT_AMOUNTS, DEFAULT_NUMBERS, DEFAULT_WORDS, defineMenu, type EntryInput, type Menu, type MenuEntry, type MenuInput, type Slot } from "./menu.ts";
export { type Drink, type Item, type Pizza, readBack, type Topping } from "./order.ts";
export { checkQuestions, pickQuestion, readBackLines, readBackOrder, wordTagOptions, wordTagQuestions } from "./questions.ts";
export { assemble, menuTags, type Tag, tokenize } from "./rules.ts";
export { type Design, type OrderCheck, type OrderResult, sameItems, takeOrder, type TakeOrderOptions, type WordReading } from "./take-order.ts";
