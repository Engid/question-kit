// A menu: the kinds of item a shop sells, the fields each kind has, every value of every field, and
// the ways customers say each value. Code looks words up in it; Jev's options are built from it.
//
//   const cafe = defineMenu({
//     name: "coffee",                              // "`order` is a customer's coffee order"
//     place: "a coffee counter",                   // "what a customer said at a coffee counter"
//     items: { drink: {}, pastry: {} },
//     fields: {
//       drink:  { items: ["drink"], names: true, values: { LATTE: ["latte", "lattes"], AMERICANO: ["americano"] } },
//       size:   { items: ["drink"], values: { SMALL: ["small"], LARGE: ["large", "big"] } },
//       milk:   { items: ["drink"], values: { OAT: ["oat", "oat milk"], WHOLE: ["whole milk"] } },
//       extras: { items: ["drink"], many: true, amounts: true, values: { SHOT: ["shot", "espresso shot"], FOAM: ["foam"] } },
//       pastry: { items: ["pastry"], names: true, values: { CROISSANT: ["croissant", "croissants"] } },
//     },
//   });
//
// Three kinds of field:
//   one value (the default)  size, milk: a later value replaces an earlier one
//   names: true              says which item it is (a drink's name): a second one starts a new item
//   many: true               a list (toppings, extras); each value can be "no …", and with
//                            amounts: true, "extra …" or "light …"
//
// A value's id is what an order holds ("OAT"); its name is how it is read back and shown to Jev (by
// default the id in lowercase, "oat"; pass { name, say } to choose).

import type { OrderItem } from "./order.ts";

/** Ways to say a value, or its name and ways to say it. */
export type ValueInput = string[] | { name: string; say: string[] };

export interface FieldInput {
  /** The kinds of item this field belongs to. */
  items: string[];
  /** How Jev's options name the field: "Topping: olives". Default: the field's name, capitalized. */
  label?: string;
  /** This field says which item it is (a drink's or a sandwich's name). */
  names?: boolean;
  /** Several values at once, each wanted or not: toppings, extras. */
  many?: boolean;
  /** With many: values can come with an amount ("extra cheese", "light ice"). */
  amounts?: boolean;
  /** Phrases that count only next to a number or an item's name: "a can of coke", but not "can i get". */
  onlyNearItem?: string[];
  values: Record<string, ValueInput>;
}

export interface KindInput {
  /** Words for the item itself: "pizza", "pie". */
  words?: string[];
  /** How to read an item of this kind back. Default: "2 large oat lattes with extra shot and no foam". */
  readBack?: ReadBack;
}

export interface MenuInput {
  /** What is ordered, as in "`order` is a customer's ___ order": "pizza and drink", "coffee". */
  name: string;
  /** Where, as in "what a customer said at ___": "a pizza counter". */
  place: string;
  /** The kinds of item, in order. The first is the default when nothing in an item says which. */
  items: Record<string, KindInput>;
  /** What items have, in the order Jev's options list them. */
  fields: Record<string, FieldInput>;
  /** How many: id is the number. Defaults to 1–15 in digits and words. */
  numbers?: Record<string, ValueInput>;
  /** Ways to ask for more or less of a value of a field with amounts. Defaults to EXTRA and LIGHT. */
  amounts?: Record<string, { describe?: string; say: string[] }>;
  /** Cue words the rules use. */
  words?: { not?: string[]; backOn?: string[] };
  /** Phrases in the questions that depend on the menu. */
  wording?: {
    /** An example of a word inside a longer name: 'like "black" in "black olives"'. Default: one from the menu. */
    wordHint?: string;
    /** What an item's details are called in the check questions: ["size", "topping"]. Default: the field labels. */
    details?: string[];
    /** How the "not" option is described. */
    not?: string;
  };
}

/** How to read an item back. `name` gives a value's name: name("size", "LARGE") → "large". */
export type ReadBack = (item: OrderItem, name: (field: string, id: string) => string) => string;

export interface MenuValue {
  /** "number", "amount", or a field's name. */
  field: string;
  id: string;
  name: string;
  say: string[];
}

export interface Field {
  id: string;
  label: string;
  items: string[];
  names: boolean;
  many: boolean;
  amounts: boolean;
  onlyNearItem: Set<string>;
  values: MenuValue[];
  /** The kind of item a value of this field implies, when the field belongs to one kind only. */
  kind?: string;
}

export interface Kind {
  id: string;
  words: string[];
  readBack?: ReadBack;
}

export interface Menu {
  name: string;
  place: string;
  kinds: Kind[];
  fields: Field[];
  numbers: MenuValue[];
  amounts: (MenuValue & { describe: string })[];
  field(id: string): Field | undefined;
  /** A way of saying something → the values it can mean (numbers, then fields in order, then amounts). */
  phrases: Map<string, MenuValue[]>;
  /** A word for an item itself → its kind. */
  kindWords: Map<string, string>;
  notWords: Set<string>;
  backOnWords: Set<string>;
  wording: { wordHint: string; details: string[]; not: string };
  /** A value's name: name("size", "LARGE") → "large". */
  nameOf(field: string, id: string): string;
}

const NUMBER_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen"];

export const DEFAULT_NUMBERS: Record<string, string[]> = Object.fromEntries(
  NUMBER_WORDS.map((w, i) => [String(i + 1), i === 0 ? ["1", "a", "an", "one", "just one"] : [w, String(i + 1)]]),
);

export const DEFAULT_AMOUNTS: Record<string, { describe?: string; say: string[] }> = {
  EXTRA: { say: ["extra", "lots of", "a lot of", "heavy on", "heavy on the", "go heavy on the"] },
  LIGHT: { say: ["light", "light on", "light on the", "go light on the", "a little", "a little bit of", "not much"] },
};

export const DEFAULT_WORDS = {
  not: ["no", "not", "without", "hold", "avoid", "don't", "dont", "skip", "minus", "except", "nothing", "none", "leave", "exclude", "remove", "never"],
  backOn: ["with", "add", "plus", "also", "include", "including", "and with", "topped"],
};

const normal = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function valuesOf(field: string, given: Record<string, ValueInput>): MenuValue[] {
  return Object.entries(given).map(([id, v]) => ({
    field,
    id,
    name: Array.isArray(v) ? id.toLowerCase().replace(/_/g, " ") : v.name,
    say: [...new Set((Array.isArray(v) ? v : v.say).map(normal))],
  }));
}

export function defineMenu(input: MenuInput): Menu {
  const kinds: Kind[] = Object.entries(input.items).map(([id, k]) => ({ id, words: k.words ?? [], ...(k.readBack ? { readBack: k.readBack } : {}) }));
  if (!kinds.length) throw new Error("a menu needs at least one kind of item");
  const fields: Field[] = Object.entries(input.fields).map(([id, f]) => {
    if (id === "number" || id === "amount") throw new Error(`"${id}" is reserved; give the field another name`);
    for (const k of f.items) if (!input.items[k]) throw new Error(`field "${id}" belongs to "${k}", which isn't one of the menu's items`);
    return {
      id,
      label: f.label ?? capitalize(id),
      items: f.items,
      names: !!f.names,
      many: !!f.many,
      amounts: !!f.amounts,
      onlyNearItem: new Set((f.onlyNearItem ?? []).map(normal)),
      values: valuesOf(id, f.values),
      ...(f.items.length === 1 ? { kind: f.items[0] } : {}),
    };
  });
  const numbers = valuesOf("number", input.numbers ?? DEFAULT_NUMBERS).sort((a, b) => Number(a.id) - Number(b.id));
  const numbersAsGiven = valuesOf("number", input.numbers ?? DEFAULT_NUMBERS);
  const amounts = Object.entries(input.amounts ?? DEFAULT_AMOUNTS).map(([id, a]) => {
    const say = [...new Set(a.say.map(normal))];
    return { field: "amount", id, name: id.toLowerCase(), say, describe: a.describe ?? `${capitalize(id.toLowerCase())}: ${say.slice(0, 3).join(", ")}` };
  });

  // Option ids must be unique: "none", "not", each kind with words, each amount, and field values.
  const cues = ["none", "not", ...kinds.filter((k) => k.words.length).map((k) => k.id), ...amounts.map((a) => a.name)];
  const dup = cues.find((c, i) => cues.indexOf(c) !== i);
  if (dup) throw new Error(`"${dup}" is used twice among item kinds, amounts and the words "none" and "not"`);

  const phrases = new Map<string, MenuValue[]>();
  for (const v of [...numbersAsGiven, ...fields.flatMap((f) => f.values), ...amounts]) for (const s of v.say) phrases.set(s, [...(phrases.get(s) ?? []), v]);
  const kindWords = new Map<string, string>();
  for (const k of kinds) for (const w of k.words) kindWords.set(normal(w), k.id);
  const byId = new Map(fields.map((f) => [f.id, f]));
  const index = new Map([...numbers, ...fields.flatMap((f) => f.values), ...amounts].map((v) => [`${v.field}:${v.id}`, v]));

  return {
    name: input.name,
    place: input.place,
    kinds,
    fields,
    numbers,
    amounts,
    field: (id) => byId.get(id),
    phrases,
    kindWords,
    notWords: new Set(input.words?.not ?? DEFAULT_WORDS.not),
    backOnWords: new Set(input.words?.backOn ?? DEFAULT_WORDS.backOn),
    wording: {
      wordHint: input.wording?.wordHint ?? defaultWordHint(fields),
      details: input.wording?.details ?? fields.map((f) => f.label.toLowerCase()),
      not: input.wording?.not ?? "Says not to include something: no, without, hold, avoid, don't, leave off",
    },
    nameOf: (field, id) => index.get(`${field}:${id}`)?.name ?? id.toLowerCase().replace(/_/g, " "),
  };
}

/** 'like "oat" in "oat milk"': the first value on the menu whose name is more than one word. */
function defaultWordHint(fields: Field[]): string {
  for (const f of fields) {
    const v = f.values.find((x) => x.name.includes(" "));
    if (v) return `like "${v.name.split(" ")[0]}" in "${v.name}"`;
  }
  return "";
}

// ------------------------------------------------------------------ how values are described to Jev

/** Other ways to say it, besides the name (at most `max`): shortest first, one per plural pair. */
export function aliasesOf(v: MenuValue, menu: Menu, max = 4): string[] {
  const stem = (s: string) => s.replace(/s$/, "");
  const seen = new Set([stem(v.name)]);
  const out: string[] = [];
  // Skip spaced-out hyphen variants ("1 - liters"), and phrases that mean two values of one field.
  const ambiguous = (s: string) => (menu.phrases.get(s)?.filter((o) => o.field === v.field).length ?? 0) > 1;
  for (const s of [...v.say].filter((x) => !x.includes(" - ") && !ambiguous(x)).sort((a, b) => a.length - b.length)) {
    if (seen.has(stem(s))) continue;
    seen.add(stem(s));
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** Values a customer could confuse with this one because their names hold all its words ("peppers" → green peppers…). */
export function lookalikesOf(v: MenuValue, menu: Menu): MenuValue[] {
  const words = (s: string) => s.split(" ").map((w) => w.replace(/s$/, ""));
  const mine = words(v.name);
  return (menu.field(v.field)?.values ?? []).filter((o) => o !== v && mine.every((w) => words(o.name).includes(w)));
}

/** A safe id for questions and options: "16.9 FLOZ" → "16_9_FLOZ". */
export const safeId = (id: string) => id.replace(/[^A-Za-z0-9]+/g, "_");
