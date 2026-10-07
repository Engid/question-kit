// The questions the pizza strategies ask Jev, one question set per kind of question, each with how
// to read the answers and what the answer key says (for scoring, explain and the oracle).
//
//   word-tag      What is this word in the order? (one Choice over the whole menu, ~170 options;
//                 or nested: what kind of thing, then which one)
//   item-start    Does a new item start at this word? (yes/no per word)
//   item-…        About one item: is it a pizza or a drink, how many, what size, and one question
//                 per style and per topping on the menu (did they ask for it, extra, or not?)
//   word-tag-follow-up  For a word Jev wasn't sure about: the word-tag question again, narrowed to
//                 its top answers and pointing at the words around it
//   order-check   The finished order read back next to what the customer said: is anything wrong,
//                 per item and for the whole order? (yes means wrong, as in TypeSafe's cascade)
//   order-pick    Two designs' orders, when they differ: which one is what the customer ordered?

import type { Answers, QuestionBatch, QuestionMeta } from "../../src/calls.ts";
import type { Entry } from "../../src/jev/types.ts";
import { type PizzaGold, goldItemOfSpan } from "./gold.ts";
import { aliasesOf, broaderOf, idOf, lookalikesOf, type Menu, type MenuEntry, PIZZA_WORDS, type Slot, stems, tagOf, type WordTag } from "./menu.ts";
import { canonical, type Drink, emptyDrink, emptyPizza, type Item, itemKey, itemsFromExr, itemToExr, orderToExr, type Pizza, parseSexp, readBack, sameOrder } from "./order.ts";

export interface PizzaQuestionSet {
  id: string;
  title: string;
  expected(meta: QuestionMeta, gold: PizzaGold): string | boolean | undefined;
}

/**
 * How the questions are worded:
 *   full   names with other spellings, and "these are different" notes (the default)
 *   bare   menu names only
 *   named  like full, but the per-style and per-topping questions ask whether the customer *names*
 *          the entry ("counts only if they say…; don't infer it"), with notes in both directions
 *          ("plain 'peppers' is a different topping" on green peppers)
 */
export type Wording = "full" | "bare" | "named";

const ref = (w: number) => `\`words.w${w}\``;
const itemRef = (k: number) => `\`items.i${k}\``;

/** The entry's name, with other ways customers write it unless the wording is bare. */
function describe(e: MenuEntry, wording: Wording): string {
  if (wording === "bare") return e.label;
  const also = aliasesOf(e);
  return `${e.label}${also.length ? ` (also written: ${also.join(", ")})` : ""}`;
}

/** "Not the same as green peppers, red peppers…": entries whose names contain this one's. */
function lookalikeNote(e: MenuEntry, wording: Wording, menu: Menu): string {
  if (wording === "bare" || !(e.slot === "topping" || e.slot === "style" || e.slot === "drink")) return "";
  const look = lookalikesOf(e, menu).map((o) => o.label);
  return look.length ? `not the same as ${look.join(", ")}` : "";
}

// ------------------------------------------------------------------ word-tag

export const WORD_TAG = "word-tag";

/** Kinds of word, for the nested version (first level), in the order they're offered. */
const KINDS: { id: string; text: string; slot?: Slot }[] = [
  { id: "none", text: "Not part of what is ordered: greetings, filler like 'i want', 'please', 'with', 'and'" },
  { id: "pizza", text: "The word for the pizza itself: pizza, pie, pizzas, pies" },
  { id: "not", text: "Says not to include something: no, without, hold, avoid, don't, leave off" },
  { id: "quantity", text: "How much of a topping: extra, lots of, a little, light", slot: "quantity" },
  { id: "number", text: "How many of an item: a, an, one, two, 3…", slot: "number" },
  { id: "size", text: "A size: small, medium, large…", slot: "size" },
  { id: "style", text: "A pizza style or crust: thin crust, deep dish, hawaiian…", slot: "style" },
  { id: "topping", text: "A topping: olives, ham, extra cheese…", slot: "topping" },
  { id: "drink", text: "A drink: coke, sprite, iced tea…", slot: "drink" },
  { id: "container", text: "A drink container: can, bottle", slot: "container" },
  { id: "volume", text: "A drink volume: 2 liter, 20 fl oz…", slot: "volume" },
];

const SLOT_WORD: Record<Slot, string> = {
  number: "How many",
  size: "Size",
  style: "Pizza style",
  topping: "Topping",
  drink: "Drink",
  container: "Container",
  volume: "Drink volume",
  quantity: "Amount of a topping",
};

function tagOptions(menu: Menu, wording: Wording, slots: Slot[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const slot of slots) {
    for (const e of menu.bySlot[slot]) {
      out[tagOf(slot, e.entity)] =
        slot === "number" ? `The quantity ${e.entity}${e.entity === "1" ? " ('a', 'an', 'one')" : wording === "full" ? ` ('${e.surfaces.find((s) => /[a-z]/.test(s)) ?? e.entity}')` : ""}` : `${SLOT_WORD[slot]}: ${describe(e, wording)}${lookalikeNote(e, wording, menu) ? `; ${lookalikeNote(e, wording, menu)}` : ""}`;
    }
  }
  return out;
}

/**
 * The word-tag options as TypeSafe's structured criteria: each says what it is, what it is not for,
 * and gives examples ("Use structured criteria for every Choice option",
 * https://docs.typesafe.ai/primitives/advanced.md). The examples are generic: the menu's own word
 * lists and made-up phrases, never words from the dev or test orders.
 */
function structuredTagCriteria(menu: Menu): Record<string, Entry> {
  const surfaces = (slot: Slot, entity: string) => menu.get(slot, entity)?.surfaces ?? [];
  const out: Record<string, Entry> = {
    none: {
      what: "Not part of what is ordered: greetings, filler and linking words",
      not_for: "a word that names something on the menu, a number of items, a size, or says not to include something",
      examples: ["hi", "i want", "can i get", "i'd like", "please", "with", "and", "thanks"],
    },
    pizza: { what: "The word for the pizza itself", examples: [...PIZZA_WORDS] },
    not: {
      what: "Says not to include something",
      not_for: "the thing left off: in 'no onions', 'onions' is a topping",
      examples: ["no", "without", "hold the", "avoid", "don't want", "leave off"],
    },
    extra: { what: "More of a topping", not_for: "the size 'extra large'", examples: ["extra", ...surfaces("quantity", "EXTRA").slice(0, 4)] },
    light: { what: "Less of a topping", not_for: "'a' or 'one' saying how many items", examples: ["a little", ...surfaces("quantity", "LIGHT").slice(0, 4)] },
  };
  for (const slot of SLOTS_IN_TAGS) {
    for (const e of menu.bySlot[slot]) {
      const notFor: string[] = [];
      if (slot === "number" && e.entity === "1") notFor.push("'a' in 'a little' (less of a topping)");
      if (slot === "container" && e.entity === "CAN") notFor.push("'can' in 'can i get'");
      if (slot === "topping" || slot === "style" || slot === "drink") {
        const kind = SLOT_WORD[slot].toLowerCase();
        for (const o of broaderOf(e, menu)) notFor.push(`plain "${o.label}" (a different ${kind})`);
        const narrower = lookalikesOf(e, menu).map((o) => o.label);
        if (narrower.length) notFor.push(`${narrower.join(", ")} (each a different ${kind})`);
      }
      const examples = slot === "number" ? e.surfaces.filter((s) => s.split(" ").length <= 2).slice(0, 4) : [e.label, ...aliasesOf(e, 3)];
      out[tagOf(slot, e.entity)] = {
        what: slot === "number" ? `The quantity ${e.entity}: how many of an item` : `${SLOT_WORD[slot]}: ${e.label}`,
        ...(notFor.length ? { not_for: notFor.join("; ") } : {}),
        examples,
      };
    }
  }
  return out;
}

const TAG_INSTRUCTIONS = (w: number) =>
  `\`order\` is a customer's pizza and drink order. What is ${ref(w)} in that order? If it is part of a longer name or phrase (like "black" in "black olives", or "a" in "a little"), answer for the whole phrase.`;

const SLOTS_IN_TAGS: Slot[] = ["number", "size", "style", "topping", "drink", "container", "volume"];

export interface TagOptions {
  nested?: boolean;
  wording?: Wording;
  /** Each option as TypeSafe's structured criteria: { what, not_for, examples }. */
  examples?: boolean;
}

/** The options of the one-level word-tag question: option id → what it means. */
export function flatTagCriteria(menu: Menu, opts: TagOptions = {}): Record<string, Entry> {
  if (opts.examples) return structuredTagCriteria(menu);
  return {
    none: KINDS[0]!.text,
    pizza: KINDS[1]!.text,
    not: KINDS[2]!.text,
    extra: "More of a topping: extra, lots of, heavy on",
    light: "Less of a topping: light, a little, not much",
    ...tagOptions(menu, opts.wording ?? "full", SLOTS_IN_TAGS),
  };
}

export function askWordTags(words: number[], menu: Menu, opts: TagOptions = {}): QuestionBatch {
  const wording = opts.wording ?? "full";
  const out: QuestionBatch = {};
  if (!opts.nested) {
    const criteria = flatTagCriteria(menu, opts);
    for (const w of words) {
      out[`tag_w${w}`] = { question: { type: "choice", instructions: TAG_INSTRUCTIONS(w), criteria }, meta: { set: WORD_TAG, word: w, level: "tag" } };
    }
    return out;
  }
  const kinds = Object.fromEntries(KINDS.map((k) => [k.id, k.text]));
  for (const w of words) {
    out[`tag_w${w}_kind`] = { question: { type: "choice", instructions: TAG_INSTRUCTIONS(w), criteria: kinds }, meta: { set: WORD_TAG, word: w, level: "kind" } };
    for (const k of KINDS) {
      if (!k.slot) continue;
      const criteria =
        k.slot === "quantity"
          ? { extra: "More: extra, lots of, heavy on", light: "Less: light, a little, not much" }
          : tagOptions(menu, wording, [k.slot]);
      out[`tag_w${w}_${k.id}`] = {
        question: { type: "choice", instructions: `${TAG_INSTRUCTIONS(w)} It is ${k.text.split(":")[0]?.toLowerCase()}: which one?`, criteria },
        meta: { set: WORD_TAG, word: w, level: k.id },
      };
    }
  }
  return out;
}

export interface TagReading {
  tag: WordTag;
  /** Probability of the tag (for nested questions, the geometric mean along the path). */
  p: number;
}

/** Jev's tag for each word asked about. */
export function readWordTags(answers: Answers, words: number[], nested = false): Map<number, TagReading> {
  const out = new Map<number, TagReading>();
  for (const w of words) {
    if (!nested) {
      const a = answers[`tag_w${w}`];
      if (a && "probabilities" in a) {
        const [tag, p] = top(a.probabilities);
        out.set(w, { tag, p });
      }
      continue;
    }
    // TypeSafe's tree rule: the best path by the geometric mean of the probabilities along it.
    const first = answers[`tag_w${w}_kind`];
    if (!first || !("probabilities" in first)) continue;
    let best: TagReading = { tag: "none", p: -1 };
    for (const [kind, pk] of Object.entries(first.probabilities)) {
      const second = answers[`tag_w${w}_${kind}`];
      if (second && "probabilities" in second) {
        const [tag, p2] = top(second.probabilities);
        const score = Math.sqrt(pk * p2);
        if (score > best.p) best = { tag, p: score };
      } else if (pk > best.p) best = { tag: kind, p: pk };
    }
    out.set(w, best);
  }
  return out;
}

function top(probs: Record<string, number>): [string, number] {
  let best: [string, number] = ["", -1];
  for (const [k, p] of Object.entries(probs)) if (p > best[1]) best = [k, p];
  return best;
}

// ------------------------------------------------------------------ word-tag-follow-up

export const WORD_TAG_FOLLOW_UP = "word-tag-follow-up";

/** An answer's top options, until they hold `cover` of the probability (at most `max`). */
export function topOptions(probs: Record<string, number>, max = 5, cover = 0.99): string[] {
  const out: string[] = [];
  let sum = 0;
  for (const [k, p] of Object.entries(probs).sort((a, b) => b[1] - a[1])) {
    if (out.length >= max || sum >= cover) break;
    out.push(k);
    sum += p;
  }
  return out;
}

/**
 * For words Jev wasn't sure about: the word-tag question again, narrowed to the options it was
 * torn between plus "none" (with the same wording), and pointing at the words around it. Like the
 * beam in TypeSafe's hierarchical classification, the first answer picks the candidates and the
 * second chooses among them.
 */
export function askTagFollowUps(words: string[], unsure: { word: number; options: string[] }[], menu: Menu, opts: TagOptions = {}): QuestionBatch {
  const all = flatTagCriteria(menu, opts);
  const out: QuestionBatch = {};
  for (const { word, options } of unsure) {
    const keep = new Set([...options, "none"]);
    const criteria = Object.fromEntries(Object.entries(all).filter(([id]) => keep.has(id)));
    const around = words.slice(Math.max(0, word - 3), word + 2).join(" ");
    out[`tag2_w${word}`] = {
      question: {
        type: "choice",
        instructions: `\`order\` is a customer's pizza and drink order. Look at ${ref(word)} where the customer says "${around}". What is ${ref(word)} there? If it is part of a longer name or phrase (like "black" in "black olives", or "a" in "a little"), answer for the whole phrase.`,
        criteria,
      },
      meta: { set: WORD_TAG_FOLLOW_UP, word, level: "tag" },
    };
  }
  return out;
}

/** Jev's tag for each word asked again. */
export function readTagFollowUps(answers: Answers, words: number[]): Map<number, TagReading> {
  const out = new Map<number, TagReading>();
  for (const w of words) {
    const a = answers[`tag2_w${w}`];
    if (a && "probabilities" in a) {
      const [tag, p] = top(a.probabilities);
      out.set(w, { tag, p });
    }
  }
  return out;
}

function kindOfTag(tag: WordTag): string {
  if (tag === "extra" || tag === "light") return "quantity";
  return tag.includes("_") ? tag.slice(0, tag.indexOf("_")) : tag;
}

function expectedWordTag(meta: QuestionMeta, gold: PizzaGold): string | undefined {
  const tag = gold.tags[meta.word ?? 0];
  if (tag === undefined) return undefined;
  if (meta.level === "tag") return tag;
  if (meta.level === "kind") return kindOfTag(tag);
  return kindOfTag(tag) === meta.level ? tag : undefined;
}

// ------------------------------------------------------------------ item-start

export const ITEM_START = "item-start";

export function askItemStarts(n: number): QuestionBatch {
  const out: QuestionBatch = {};
  for (let w = 2; w <= n; w++) {
    out[`start_w${w}`] = {
      question: {
        type: "noul",
        instructions: `\`order\` is a customer's pizza and drink order, made of one or more items: each item is one kind of pizza or drink with its own quantity, size and toppings ("two large ham pizzas and a coke" has two items). Does a new item start at ${ref(w)}?`,
        criteria: { true: `${ref(w)} is the first word of another item`, false: `${ref(w)} continues the same item, or is filler between items` },
      },
      meta: { set: ITEM_START, word: w },
    };
  }
  return out;
}

function expectedItemStart(meta: QuestionMeta, gold: PizzaGold): boolean | undefined {
  const w = meta.word ?? 0;
  return gold.items.slice(1).some((it) => it.words[0] === w);
}

// ------------------------------------------------------------------ item questions

export const ITEM_KIND = "item-kind";
export const ITEM_NUMBER = "item-number";
export const ITEM_SIZE = "item-size";
export const ITEM_STYLE = "item-style";
export const ITEM_TOPPING = "item-topping";
export const ITEM_DRINK = "item-drink";
export const ITEM_CONTAINER = "item-container";
export const ITEM_VOLUME = "item-volume";

const TOPPING_ANSWERS: Record<string, string> = {
  no: "Not mentioned for this item",
  yes: "Wanted, a normal amount",
  extra: "Wanted, extra (extra, more, lots of, heavy on)",
  light: "Wanted, a little (light, a little, not much)",
  not: "Not wanted: the customer says to leave it off (no, without, hold, avoid)",
  not_extra: "The customer says not to make it extra ('no extra cheese')",
};

const STYLE_ANSWERS: Record<string, string> = {
  no: "Not mentioned for this item",
  yes: "Wanted",
  not: "Not wanted: the customer says they don't want this style",
};

/**
 * Every menu question about item k, asked whatever the item turns out to be (code reads the ones
 * that apply once Jev says whether it's a pizza or a drink).
 */
export function askItem(k: number, span: number[], menu: Menu, wording: Wording = "full", only?: Set<string>, examples = false): QuestionBatch {
  const it = itemRef(k);
  const meta = (set: string, extra: Partial<QuestionMeta> = {}): QuestionMeta => ({ set, item: k, phrase: span, ...extra });
  const choiceOf = (none: string, slot: Slot) => ({
    none,
    ...Object.fromEntries(menu.bySlot[slot].map((e) => [idOf(e.entity), `${describe(e, wording)}${lookalikeNote(e, wording, menu) ? `; ${lookalikeNote(e, wording, menu)}` : ""}`])),
  });
  const out: QuestionBatch = {
    [`kind_i${k}`]: {
      question: {
        type: "choice",
        instructions: `\`order\` is a customer's pizza and drink order; ${it} is one part of it. What does ${it} order?`,
        criteria: {
          pizza: "One or more pizzas (pies) made the same way",
          drink: "One or more drinks of the same kind",
          none: "Nothing: greetings, filler, or words that don't order anything",
        },
      },
      meta: meta(ITEM_KIND),
    },
    [`number_i${k}`]: {
      question: {
        type: "choice",
        instructions: `In ${it}, how many of the pizza or drink does the customer want? 'a', 'an' or no number means 1.`,
        criteria: Object.fromEntries(menu.bySlot.number.map((e) => [e.entity, e.entity])),
      },
      meta: meta(ITEM_NUMBER),
    },
    [`size_i${k}`]: {
      question: { type: "choice", instructions: `What size does the customer ask for in ${it}?`, criteria: choiceOf("No size is given for this item", "size") },
      meta: meta(ITEM_SIZE),
    },
    [`drink_i${k}`]: {
      question: { type: "choice", instructions: `Which drink does ${it} order?`, criteria: choiceOf("No drink: this part orders pizza, or nothing", "drink") },
      meta: meta(ITEM_DRINK),
    },
    [`container_i${k}`]: {
      question: { type: "choice", instructions: `Does the customer ask for the drink in ${it} in a can or a bottle?`, criteria: choiceOf("Neither is said", "container") },
      meta: meta(ITEM_CONTAINER),
    },
    [`volume_i${k}`]: {
      question: { type: "choice", instructions: `What drink volume does ${it} ask for?`, criteria: choiceOf("No volume is given", "volume") },
      meta: meta(ITEM_VOLUME),
    },
  };
  const asked = (e: MenuEntry) => !only || only.has(e.entity);
  for (const e of menu.bySlot.style.filter(asked)) {
    out[`style_i${k}_${idOf(e.entity)}`] = {
      question:
        wording === "named"
          ? { type: "choice", instructions: `Does the customer name the style ${e.label} for ${it}? ${countsOnly(e)} Don't infer a style from the toppings or from other styles they name.${bothWays(e, menu, "styles")}`, criteria: examples ? styleNamedExamples(e, menu) : STYLE_NAMED }
          : { type: "choice", instructions: `Does the customer want ${it} to be ${describe(e, wording)}?${separate(e, wording, menu, "styles")}`, criteria: STYLE_ANSWERS },
      meta: meta(ITEM_STYLE, { entity: e.entity }),
    };
  }
  for (const e of menu.bySlot.topping.filter(asked)) {
    out[`topping_i${k}_${idOf(e.entity)}`] = {
      question:
        wording === "named"
          ? { type: "choice", instructions: `Does the customer name ${e.label} for ${it}? ${countsOnly(e)} Don't infer it from anything else they say.${bothWays(e, menu, "toppings")}`, criteria: examples ? toppingNamedExamples(e, menu) : TOPPING_NAMED }
          : { type: "choice", instructions: `Does the customer want ${describe(e, wording)} on ${it}?${separate(e, wording, menu, "toppings")}`, criteria: TOPPING_ANSWERS },
      meta: meta(ITEM_TOPPING, { entity: e.entity }),
    };
  }
  return out;
}

const TOPPING_NAMED: Record<string, string> = {
  no: "Not named for this item",
  yes: "Named, a normal amount",
  extra: "Named with more of it: extra, more, lots of, heavy on",
  light: "Named with less of it: light, a little, not much",
  not: "Named as unwanted: no …, without …, hold the …, avoid …",
  not_extra: "Named as 'not extra' ('no extra cheese')",
};

const STYLE_NAMED: Record<string, string> = {
  no: "Not named for this item",
  yes: "Named as wanted",
  not: "Named as unwanted ('not thin crust', 'without the deep dish'); picking a different style doesn't count",
};

/**
 * The named answers as TypeSafe's structured criteria, with generic examples made from the
 * entry's own name (never words from the dev or test orders).
 */
function toppingNamedExamples(e: MenuEntry, menu: Menu): Record<string, Entry> {
  const name = e.label;
  const other = menu.bySlot.topping.find((o) => o !== e && !broaderOf(e, menu).includes(o) && !lookalikesOf(e, menu).includes(o))?.label ?? "ham";
  const plainer = broaderOf(e, menu).map((o) => o.label);
  const broader = plainer.map((b) => `plain "${b}" (a different topping)`);
  return {
    no: { what: TOPPING_NAMED.no!, not_for: `any mention of ${name} for this item`, examples: [`a pizza with ${other}`, ...plainer.map((b) => `a pizza with ${b}`)] },
    yes: {
      what: TOPPING_NAMED.yes!,
      not_for: ["a topping that usually goes with what they did say, when they don't say it", ...broader].join("; "),
      examples: [`a pizza with ${name}`, `add ${name}`, `${name} please`],
    },
    extra: { what: TOPPING_NAMED.extra!, examples: [`extra ${name}`, `lots of ${name}`, `heavy on the ${name}`] },
    light: { what: TOPPING_NAMED.light!, examples: [`light ${name}`, `a little ${name}`, `go light on the ${name}`] },
    not: { what: TOPPING_NAMED.not!, examples: [`no ${name}`, `without ${name}`, `hold the ${name}`] },
    not_extra: { what: TOPPING_NAMED.not_extra!, examples: [`no extra ${name}`, `not extra ${name}`] },
  };
}

function styleNamedExamples(e: MenuEntry, menu: Menu): Record<string, Entry> {
  const name = e.label;
  const broader = broaderOf(e, menu).map((o) => `plain "${o.label}" (a different style)`);
  return {
    no: { what: STYLE_NAMED.no!, not_for: `any mention of ${name} for this item`, examples: ["a pizza with ham and olives"] },
    yes: { what: STYLE_NAMED.yes!, not_for: ["a style that fits the toppings, when they don't say it", ...broader].join("; "), examples: [`a ${name} pizza`, `make it ${name}`] },
    not: { what: STYLE_NAMED.not!, examples: [`not ${name}`, `no ${name}`, `without the ${name}`] },
  };
}

/** "It counts only if they say thin crust (or: thin crusts)." */
function countsOnly(e: MenuEntry): string {
  const also = aliasesOf(e);
  return `It counts only if they say ${e.label}${also.length ? ` (or: ${also.join(", ")})` : ""}.`;
}

/** Notes in both directions: plainer names are different entries, and so are more specific ones. */
function bothWays(e: MenuEntry, menu: Menu, what: string): string {
  const broader = broaderOf(e, menu).map((o) => `"${o.label}"`);
  const narrower = lookalikesOf(e, menu).map((o) => o.label);
  return (
    (broader.length ? ` If they only say ${broader.join(" or ")}, that is a different entry, so the answer here is "not named".` : "") +
    (narrower.length ? ` ${narrower.join(", ")} are separate ${what} with their own questions.` : "")
  );
}

/**
 * Menu entries worth asking about for a part of the order: those sharing a word with it ("cheese"
 * brings in every cheese). The rest can't have been named, so code answers "not named" for them.
 */
export function candidateEntries(text: string, menu: Menu): Set<string> {
  const STOP = new Set(["with", "and", "the", "a", "an", "of", "on", "in", "no", "not", "i", "to", "it", "me", "my", "please", "pizza", "pie", "want", "like", "order", "get", "have", "some", "extra", "light", "but", "for", "can", "one"]);
  const words = new Set(stems(text).filter((w) => w.length > 1 && !STOP.has(w)));
  const out = new Set<string>();
  for (const e of [...menu.bySlot.topping, ...menu.bySlot.style]) {
    if (e.surfaces.some((s) => stems(s).some((w) => words.has(w)))) out.add(e.entity);
  }
  return out;
}

/** " Answer only for peppers: banana peppers, green peppers… are separate toppings with their own questions." */
function separate(e: MenuEntry, wording: Wording, menu: Menu, what: string): string {
  if (wording === "bare") return "";
  const look = lookalikesOf(e, menu).map((o) => o.label);
  return look.length ? ` Answer only for ${e.label}: ${look.join(", ")} are separate ${what} with their own questions.` : "";
}

export interface ItemReading {
  item: Item | undefined;
  /** The lowest top-answer probability among the answers the item was built from. */
  confidence: number;
}

/** Item k from Jev's answers, or undefined when Jev says the part orders nothing. */
export function readItem(answers: Answers, k: number, menu: Menu): ItemReading {
  const ps: number[] = [];
  const pick = (id: string): string | undefined => {
    const a = answers[id];
    if (!a || !("probabilities" in a)) return undefined;
    const [choice, p] = top(a.probabilities);
    ps.push(p);
    return choice;
  };
  const kind = pick(`kind_i${k}`);
  if (kind !== "pizza" && kind !== "drink") return { item: undefined, confidence: Math.min(...ps, 1) };
  const number = Number(pick(`number_i${k}`) ?? 1) || 1;
  const size = pick(`size_i${k}`);
  const entity = (slot: Slot, id: string | undefined) => (id && id !== "none" ? menu.bySlot[slot].find((e) => idOf(e.entity) === id)?.entity : undefined);
  if (kind === "drink") {
    const d: Drink = emptyDrink();
    d.number = number;
    const s = entity("size", size);
    if (s) d.size = s;
    const dr = entity("drink", pick(`drink_i${k}`));
    if (dr) d.drink = dr;
    const c = entity("container", pick(`container_i${k}`));
    if (c) d.container = c;
    const v = entity("volume", pick(`volume_i${k}`));
    if (v) d.volume = v;
    return { item: d, confidence: Math.min(...ps) };
  }
  const p: Pizza = emptyPizza();
  p.number = number;
  const s = entity("size", size);
  if (s) p.size = s;
  for (const e of menu.bySlot.style) {
    const a = pick(`style_i${k}_${idOf(e.entity)}`);
    if (a === "yes") p.styles.push({ name: e.entity });
    else if (a === "not") p.styles.push({ name: e.entity, not: true });
  }
  for (const e of menu.bySlot.topping) {
    const a = pick(`topping_i${k}_${idOf(e.entity)}`);
    if (a === "yes") p.toppings.push({ name: e.entity });
    else if (a === "extra") p.toppings.push({ name: e.entity, quantity: "EXTRA" });
    else if (a === "light") p.toppings.push({ name: e.entity, quantity: "LIGHT" });
    else if (a === "not") p.toppings.push({ name: e.entity, not: true });
    else if (a === "not_extra") p.toppings.push({ name: e.entity, quantity: "EXTRA", not: true });
  }
  return { item: p, confidence: Math.min(...ps) };
}

/** The answer-key item behind the part a question is about (undefined if none). */
function goldItemOf(meta: QuestionMeta, gold: PizzaGold): Item | undefined {
  const g = goldItemOfSpan(gold, meta.phrase ?? []);
  return g ? gold.items[g - 1]?.item : undefined;
}

function expectedItem(meta: QuestionMeta, gold: PizzaGold): string | undefined {
  const it = goldItemOf(meta, gold);
  if (meta.set === ITEM_KIND) return it ? it.kind : "none";
  if (!it) return undefined;
  if (meta.set === ITEM_NUMBER) return String(it.number);
  if (meta.set === ITEM_SIZE) return it.size ? idOf(it.size) : "none";
  if (it.kind === "drink") {
    if (meta.set === ITEM_DRINK) return it.drink ? idOf(it.drink) : "none";
    if (meta.set === ITEM_CONTAINER) return it.container ? idOf(it.container) : "none";
    if (meta.set === ITEM_VOLUME) return it.volume ? idOf(it.volume) : "none";
    return undefined;
  }
  if (meta.set === ITEM_STYLE) {
    const s = it.styles.find((x) => x.name === meta.entity);
    return !s ? "no" : s.not ? "not" : "yes";
  }
  if (meta.set === ITEM_TOPPING) {
    const t = it.toppings.find((x) => x.name === meta.entity);
    if (!t) return "no";
    if (t.not) return t.quantity === "EXTRA" ? "not_extra" : "not";
    return t.quantity === "EXTRA" ? "extra" : t.quantity === "LIGHT" ? "light" : "yes";
  }
  return undefined;
}

// ------------------------------------------------------------------ order-check and order-pick

export const ORDER_CHECK = "order-check";
export const ORDER_PICK = "order-pick";

/** The order read back, one line per item: { i1: "2 large pizzas with ham", i2: "1 coke" }. */
export function readBackOrder(items: Item[], menu: Menu): Entry {
  const label = (slot: string, entity: string) => menu.get(slot as Slot, entity)?.label ?? entity.toLowerCase().replace(/_/g, " ");
  return items.length ? Object.fromEntries(items.map((it, k) => [`i${k + 1}`, readBack(it, label)])) : "nothing";
}

const CHECK_CONTEXT = "`order` is what a customer said at a pizza counter. `summary` is what the clerk wrote down, one line per item.";

/**
 * Is the order wrong? Asked three ways in one call, each phrased so that yes means something is
 * wrong, as in TypeSafe's verification cascade (https://docs.typesafe.ai/cookbooks/sde_cascade.md):
 * the whole order; each item (something it has that the customer didn't ask for, or a wrong
 * detail); and anything the customer asked for that the summary leaves out.
 */
export function askOrderCheck(items: Item[]): QuestionBatch {
  const exr = orderToExr(items);
  const out: QuestionBatch = {
    check_order: {
      question: {
        type: "noul",
        instructions: `${CHECK_CONTEXT} Is \`summary\` wrong in any way: a pizza or drink, number, size, style, topping or drink detail that is missing, extra, or different from what the customer asked for?`,
        criteria: { true: "`summary` is wrong somewhere", false: "`summary` is exactly what the customer ordered" },
      },
      meta: { set: ORDER_CHECK, level: "whole", exr },
    },
  };
  items.forEach((it, i) => {
    const k = i + 1;
    out[`check_i${k}`] = {
      question: {
        type: "noul",
        instructions: `${CHECK_CONTEXT} Does \`summary.i${k}\` include something the customer didn't ask for, or get a number, size, style, topping or drink wrong?`,
        criteria: { true: `Something in \`summary.i${k}\` is wrong or wasn't asked for`, false: `Everything in \`summary.i${k}\` is what the customer asked for` },
      },
      meta: { set: ORDER_CHECK, level: "item", item: k, exr: itemToExr(it) },
    };
  });
  out.check_missing = {
    question: {
      type: "noul",
      instructions: `${CHECK_CONTEXT} Did the customer ask for something that \`summary\` leaves out: a whole pizza or drink, or a size, style, topping or drink detail?`,
      criteria: { true: "Something the customer asked for is missing from `summary`", false: "Nothing the customer asked for is missing" },
    },
    meta: { set: ORDER_CHECK, level: "missing", exr },
  };
  return out;
}

export interface OrderCheck {
  /** P(wrong) from the whole-order question. */
  whole: number;
  /** The highest P(wrong) among the per-item and "anything missing?" questions (TypeSafe's max-style gate). */
  parts: number;
}

export function readOrderCheck(answers: Answers, items: number): OrderCheck {
  const p = (id: string) => {
    const a = answers[id];
    return a && "noul" in a ? a.noul : 1;
  };
  const parts = [...Array.from({ length: items }, (_, i) => p(`check_i${i + 1}`)), p("check_missing")];
  return { whole: p("check_order"), parts: Math.max(...parts) };
}

/** Facts of an item, for "is anything left out?": number, size, each style and topping, drink details. */
function factsOf(it: Item): string[] {
  const out = [`number:${it.number}`, ...(it.size ? [`size:${it.size}`] : [])];
  if (it.kind === "pizza") {
    for (const s of it.styles) out.push(`style:${s.not ? "not " : ""}${s.name}`);
    for (const t of it.toppings) out.push(`topping:${t.not ? "not " : ""}${t.quantity ?? ""} ${t.name}`);
  } else {
    if (it.drink) out.push(`drink:${it.drink}`);
    if (it.container) out.push(`container:${it.container}`);
    if (it.volume) out.push(`volume:${it.volume}`);
  }
  return out;
}

function expectedCheck(meta: QuestionMeta, gold: PizzaGold): boolean | undefined {
  if (typeof meta.exr !== "string") return undefined;
  const want = gold.items.map((g) => g.item);
  if (meta.level === "whole") return !sameOrder(meta.exr, gold.row.exr);
  if (meta.level === "item") {
    const key = canonical(parseSexp(meta.exr));
    return !want.some((g) => itemKey(g) === key);
  }
  if (meta.level === "missing") {
    const got = itemsFromExr(meta.exr);
    return want.some((g) => !got.some((p) => p.kind === g.kind && factsOf(g).every((f) => factsOf(p).includes(f))));
  }
  return undefined;
}

/**
 * Two designs' orders, when they differ: which one is what the customer said? `swap` puts the
 * second design first, so that over many orders neither design always gets the first position.
 */
export function askOrderPick(text: string, a: Item[], b: Item[], menu: Menu, swap: boolean): { state: Entry; questions: QuestionBatch } {
  const [first, second] = swap ? [b, a] : [a, b];
  return {
    state: { order: text, a: readBackOrder(first, menu), b: readBackOrder(second, menu) },
    questions: {
      pick: {
        question: {
          type: "choice",
          instructions: "`order` is what a customer said at a pizza counter. `a` and `b` are two clerks' write-ups of it, one line per item, and they differ. Which one is exactly what the customer ordered: every pizza and drink, number, size, style, topping and drink detail?",
          criteria: { a: "`a` is exactly right", b: "`b` is exactly right", neither: "Neither is exactly right" },
        },
        meta: { set: ORDER_PICK, exr: { a: orderToExr(first), b: orderToExr(second) } },
      },
    },
  };
}

/** Which design Jev picked ("first" / "second" as passed to askOrderPick, or "neither"), and how sure. */
export function readOrderPick(answers: Answers, swap: boolean): { pick: "first" | "second" | "neither"; p: number } {
  const a = answers.pick;
  if (!a || !("probabilities" in a)) return { pick: "neither", p: 0 };
  const [choice, p] = top(a.probabilities);
  if (choice === "neither") return { pick: "neither", p };
  return { pick: (choice === "a") !== swap ? "first" : "second", p };
}

function expectedPick(meta: QuestionMeta, gold: PizzaGold): string | undefined {
  if (!meta.exr || typeof meta.exr === "string") return undefined;
  for (const [option, exr] of Object.entries(meta.exr)) if (sameOrder(exr, gold.row.exr)) return option;
  return "neither";
}

// ------------------------------------------------------------------ registry

export const PIZZA_QUESTION_SETS: Record<string, PizzaQuestionSet> = Object.fromEntries(
  [
    { id: WORD_TAG, title: "What is this word in the order? (a menu entry, a quantity, 'no', or nothing)", expected: expectedWordTag },
    { id: ITEM_START, title: "Does a new item start at this word?", expected: expectedItemStart },
    { id: ITEM_KIND, title: "Is this part a pizza, a drink, or nothing?", expected: expectedItem },
    { id: ITEM_NUMBER, title: "How many?", expected: expectedItem },
    { id: ITEM_SIZE, title: "What size?", expected: expectedItem },
    { id: ITEM_STYLE, title: "Does the customer want this style? (one question per style on the menu)", expected: expectedItem },
    { id: ITEM_TOPPING, title: "Does the customer want this topping, extra, or not? (one per topping)", expected: expectedItem },
    { id: ITEM_DRINK, title: "Which drink?", expected: expectedItem },
    { id: ITEM_CONTAINER, title: "Can or bottle?", expected: expectedItem },
    { id: ITEM_VOLUME, title: "What volume?", expected: expectedItem },
    { id: WORD_TAG_FOLLOW_UP, title: "Asked again for words Jev wasn't sure about: what is this word? (its top answers and 'none')", expected: expectedWordTag },
    { id: ORDER_CHECK, title: "The order read back: is anything wrong? (the whole order, each item, anything missing; yes = wrong)", expected: expectedCheck },
    { id: ORDER_PICK, title: "Two designs' orders differ: which is exactly what the customer ordered?", expected: expectedPick },
  ].map((q) => [q.id, q]),
);

/** Report-card row for a question: two-level word tags get a row per level. */
export function pizzaRowOf(meta: QuestionMeta): string {
  if (meta.set === WORD_TAG) return meta.level === "tag" ? "word-tag" : meta.level === "kind" ? "word-tag (kind)" : "word-tag (which one)";
  if (meta.set === ORDER_CHECK) return `order-check (${meta.level === "whole" ? "whole order" : meta.level === "item" ? "each item" : "anything missing"})`;
  return meta.set;
}

