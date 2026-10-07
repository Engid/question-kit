// The menu: every size, style, topping, drink, container and volume the shop has, and the ways
// customers say each one. Both halves of the order taker read it: code looks words up in it, and
// Jev's options are built from it.
//
//   const menu = defineMenu({
//     sizes: { SMALL: ["small"], LARGE: ["large", "big"] },
//     styles: { THIN_CRUST: ["thin crust", "thin"] },
//     toppings: { OLIVES: ["olives", "black olives"], GREEN_PEPPERS: ["green peppers", "green pepper"] },
//     drinks: { COKE: ["coke", "coca cola"], DIET_COKE: ["diet coke"] },
//   });
//
// An entry's id is what an order holds ("GREEN_PEPPERS"); its name is how it is read back and
// shown to Jev (by default the id in lowercase, "green peppers"; pass { name, say } to choose).

/** What a word can name. The first seven are the parts of an order; "amount" is extra or light. */
export type Slot = "number" | "size" | "style" | "topping" | "drink" | "container" | "volume" | "amount";

export interface MenuEntry {
  slot: Slot;
  /** What an order holds: "GREEN_PEPPERS", "LARGE", "2 LITER", "3". */
  id: string;
  /** How it is read back and shown to Jev: "green peppers". */
  name: string;
  /** Every way customers say it, lowercase. */
  say: string[];
}

/** Ways to say an entry, or its name and ways to say it. */
export type EntryInput = string[] | { name: string; say: string[] };

export interface MenuInput {
  sizes: Record<string, EntryInput>;
  styles?: Record<string, EntryInput>;
  toppings: Record<string, EntryInput>;
  drinks?: Record<string, EntryInput>;
  containers?: Record<string, EntryInput>;
  volumes?: Record<string, EntryInput>;
  /** How many: id is the number ("1", "2" …). Defaults to 1–15 in digits and words. */
  numbers?: Record<string, EntryInput>;
  /** Ways to ask for more or less of a topping. */
  amounts?: { EXTRA: string[]; LIGHT: string[] };
  /** Cue words the rules use. */
  words?: { pizza?: string[]; not?: string[]; backOn?: string[] };
}

export interface Menu {
  entries: MenuEntry[];
  bySlot: Record<Slot, MenuEntry[]>;
  get(slot: Slot, id: string): MenuEntry | undefined;
  /** A way of saying something → the entries it can mean (in slot order). */
  phrases: Map<string, MenuEntry[]>;
  /** The word for the pizza itself. */
  pizzaWords: Set<string>;
  /** Words that start "don't put this on": no peppers, hold the ham. */
  notWords: Set<string>;
  /** Words after which toppings are wanted again: "no ham but with olives". */
  backOnWords: Set<string>;
}

const NUMBER_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen"];

export const DEFAULT_NUMBERS: Record<string, string[]> = Object.fromEntries(
  NUMBER_WORDS.map((w, i) => [String(i + 1), i === 0 ? ["1", "a", "an", "one", "just one"] : [w, String(i + 1)]]),
);

export const DEFAULT_AMOUNTS = {
  EXTRA: ["extra", "lots of", "a lot of", "heavy on", "heavy on the", "go heavy on the"],
  LIGHT: ["light", "light on", "light on the", "go light on the", "a little", "a little bit of", "not much"],
};

export const DEFAULT_WORDS = {
  pizza: ["pizza", "pizzas", "pie", "pies"],
  not: ["no", "not", "without", "hold", "avoid", "don't", "dont", "skip", "minus", "except", "nothing", "none", "leave", "exclude", "remove", "never"],
  backOn: ["with", "add", "plus", "also", "include", "including", "and with", "topped"],
};

/** Slots in the order the menu is built and offered. */
export const SLOTS: Slot[] = ["number", "size", "style", "topping", "drink", "container", "volume", "amount"];

const normal = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const defaultName = (id: string) => id.toLowerCase().replace(/_/g, " ");

export function defineMenu(input: MenuInput): Menu {
  const given: Record<Slot, Record<string, EntryInput>> = {
    number: input.numbers ?? DEFAULT_NUMBERS,
    size: input.sizes,
    style: input.styles ?? {},
    topping: input.toppings,
    drink: input.drinks ?? {},
    container: input.containers ?? {},
    volume: input.volumes ?? {},
    amount: input.amounts ?? DEFAULT_AMOUNTS,
  };
  const entries: MenuEntry[] = [];
  for (const slot of SLOTS) {
    for (const [id, e] of Object.entries(given[slot])) {
      const say = Array.isArray(e) ? e : e.say;
      const name = Array.isArray(e) ? (slot === "amount" ? id.toLowerCase() : defaultName(id)) : e.name;
      entries.push({ slot, id, name, say: [...new Set(say.map(normal))] });
    }
  }
  const bySlot = Object.fromEntries(SLOTS.map((s) => [s, entries.filter((e) => e.slot === s)])) as Record<Slot, MenuEntry[]>;
  bySlot.number.sort((a, b) => Number(a.id) - Number(b.id));
  const phrases = new Map<string, MenuEntry[]>();
  for (const e of entries) for (const s of e.say) phrases.set(s, [...(phrases.get(s) ?? []), e]);
  const index = new Map(entries.map((e) => [`${e.slot}:${e.id}`, e]));
  const words = { ...DEFAULT_WORDS, ...input.words };
  return {
    entries,
    bySlot,
    get: (slot, id) => index.get(`${slot}:${id}`),
    phrases,
    pizzaWords: new Set(words.pizza),
    notWords: new Set(words.not),
    backOnWords: new Set(words.backOn),
  };
}

// ------------------------------------------------------------------ how entries are described to Jev

/** Other ways to say it, besides the name (at most `max`): shortest first, one per plural pair. */
export function aliasesOf(e: MenuEntry, menu: Menu, max = 4): string[] {
  const stem = (s: string) => s.replace(/s$/, "");
  const seen = new Set([stem(e.name)]);
  const out: string[] = [];
  // Skip spaced-out hyphen variants ("1 - liters"), and phrases that mean two entries of the same
  // kind (a menu can list one phrase under two volumes).
  const ambiguous = (s: string) => (menu.phrases.get(s)?.filter((o) => o.slot === e.slot).length ?? 0) > 1;
  for (const s of [...e.say].filter((x) => !x.includes(" - ") && !ambiguous(x)).sort((a, b) => a.length - b.length)) {
    if (seen.has(stem(s))) continue;
    seen.add(stem(s));
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** Entries a customer could confuse with this one because their names hold all its words ("peppers" → green peppers, red peppers…). */
export function lookalikesOf(e: MenuEntry, menu: Menu): MenuEntry[] {
  const words = (s: string) => s.split(" ").map((w) => w.replace(/s$/, ""));
  const mine = words(e.name);
  return menu.bySlot[e.slot].filter((o) => o !== e && mine.every((w) => words(o.name).includes(w)));
}

/** A safe id for questions and options: "16.9 FLOZ" → "16_9_FLOZ". */
export const safeId = (id: string) => id.replace(/[^A-Za-z0-9]+/g, "_");
