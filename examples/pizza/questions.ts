// The questions the pizza strategies ask Jev, one question set per kind of question, each with how
// to read the answers and what the answer key says (for scoring, explain and the oracle).
//
//   word-tag      What is this word in the order? (one Choice over the whole menu, ~170 options;
//                 or nested: what kind of thing, then which one)
//   item-start    Does a new item start at this word? (yes/no per word)
//   item-…        About one item: is it a pizza or a drink, how many, what size, and one question
//                 per style and per topping on the menu (did they ask for it, extra, or not?)

import type { Answers, QuestionBatch, QuestionMeta } from "../../src/calls.ts";
import { type PizzaGold, goldItemOfSpan } from "./gold.ts";
import { aliasesOf, idOf, lookalikesOf, type Menu, type MenuEntry, type Slot, tagOf, type WordTag } from "./menu.ts";
import { type Drink, emptyDrink, emptyPizza, type Item, type Pizza } from "./order.ts";

export interface PizzaQuestionSet {
  id: string;
  title: string;
  expected(meta: QuestionMeta, gold: PizzaGold): string | boolean | undefined;
}

/** How much the questions explain: aliases and "these are different" notes, or bare names. */
export type Wording = "full" | "bare";

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

const TAG_INSTRUCTIONS = (w: number) =>
  `\`order\` is a customer's pizza and drink order. What is ${ref(w)} in that order? If it is part of a longer name or phrase (like "black" in "black olives", or "a" in "a little"), answer for the whole phrase.`;

const SLOTS_IN_TAGS: Slot[] = ["number", "size", "style", "topping", "drink", "container", "volume"];

export function askWordTags(words: number[], menu: Menu, opts: { nested?: boolean; wording?: Wording } = {}): QuestionBatch {
  const wording = opts.wording ?? "full";
  const out: QuestionBatch = {};
  if (!opts.nested) {
    const criteria: Record<string, string> = {
      none: KINDS[0]!.text,
      pizza: KINDS[1]!.text,
      not: KINDS[2]!.text,
      extra: "More of a topping: extra, lots of, heavy on",
      light: "Less of a topping: light, a little, not much",
      ...tagOptions(menu, wording, SLOTS_IN_TAGS),
    };
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
export function askItem(k: number, span: number[], menu: Menu, wording: Wording = "full"): QuestionBatch {
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
  for (const e of menu.bySlot.style) {
    out[`style_i${k}_${idOf(e.entity)}`] = {
      question: { type: "choice", instructions: `Does the customer want ${it} to be ${describe(e, wording)}?${separate(e, wording, menu, "styles")}`, criteria: STYLE_ANSWERS },
      meta: meta(ITEM_STYLE, { entity: e.entity }),
    };
  }
  for (const e of menu.bySlot.topping) {
    out[`topping_i${k}_${idOf(e.entity)}`] = {
      question: { type: "choice", instructions: `Does the customer want ${describe(e, wording)} on ${it}?${separate(e, wording, menu, "toppings")}`, criteria: TOPPING_ANSWERS },
      meta: meta(ITEM_TOPPING, { entity: e.entity }),
    };
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
  ].map((q) => [q.id, q]),
);

/** Report-card row for a question: two-level word tags get a row per level. */
export function pizzaRowOf(meta: QuestionMeta): string {
  if (meta.set === WORD_TAG) return meta.level === "tag" ? "word-tag" : meta.level === "kind" ? "word-tag (kind)" : "word-tag (which one)";
  return meta.set;
}

