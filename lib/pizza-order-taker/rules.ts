// The code half of the order taker:
//
// 1. tokenize: the customer's words, lowercase.
// 2. menuTags: look every word up in the menu (longest phrase first), so "black olives" → OLIVES
//    and "a little" → light. Words the menu doesn't know stay "none" (Jev is asked about those).
// 3. assemble: turn one tag per word into items. A number starts a new item once the current one
//    has something in it; a drink after a pizza starts a new item; "no"/"without" make the toppings
//    after them unwanted until "with"/"add"; "extra"/"light" apply to the next topping.
//
// A tag is what a single word is: a menu entry ("topping_OLIVES", "number_2", "size_LARGE"),
// "extra" / "light", "pizza", "not", or "none".

import { type Menu, type MenuEntry, safeId, type Slot } from "./menu.ts";
import { type Drink, emptyDrink, emptyPizza, type Item, type Pizza } from "./order.ts";

export type Tag = string;

/** The longest menu phrase looked up, in words. */
const LONGEST_PHRASE = 6;

/** The tag for a menu entry. */
export const tagOf = (e: Pick<MenuEntry, "slot" | "id">): Tag => (e.slot === "amount" ? e.id.toLowerCase() : `${e.slot}_${safeId(e.id)}`);

/** The menu entry a tag names, if any. */
export function entryOfTag(tag: Tag, menu: Menu): MenuEntry | undefined {
  if (tag === "extra" || tag === "light") return menu.get("amount", tag.toUpperCase());
  const i = tag.indexOf("_");
  if (i < 0) return undefined;
  return menu.bySlot[tag.slice(0, i) as Slot]?.find((e) => safeId(e.id) === tag.slice(i + 1));
}

/** The customer's words: lowercase, split on spaces, without commas and full stops ("16.9" keeps its point). */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[,;!?"()]+/g, " ")
    .replace(/\.(?!\d)/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** A tag for every word (index 0 unused), from the menu's phrases. */
export function menuTags(words: string[], menu: Menu): Tag[] {
  const lower = words.map((w) => w.toLowerCase());
  const tags: Tag[] = ["", ...lower.map(() => "none")];
  let i = 0;
  while (i < lower.length) {
    let matched = 0;
    for (let len = Math.min(LONGEST_PHRASE, lower.length - i); len >= 1 && !matched; len--) {
      const phrase = lower.slice(i, i + len).join(" ");
      const e = menu.phrases.get(phrase)?.[0];
      if (!e) continue;
      // "can" is a container only next to a drink or a number ("a can of coke", "two cans"), not in "can i get".
      if (e.slot === "container" && /^cans?$/.test(phrase) && !nearDrink(lower, i, menu)) continue;
      for (let k = 0; k < len; k++) tags[i + k + 1] = tagOf(e);
      matched = len;
    }
    if (!matched) {
      const w = lower[i]!;
      if (menu.pizzaWords.has(w)) tags[i + 1] = "pizza";
      else if (menu.notWords.has(w)) tags[i + 1] = "not";
      matched = 1;
    }
    i += matched;
  }
  return tags;
}

function nearDrink(lower: string[], i: number, menu: Menu): boolean {
  const drinkish = (w: string | undefined) => !!w && (menu.phrases.get(w)?.some((e) => e.slot === "drink" || e.slot === "number") ?? false);
  return lower[i + 1] === "of" || drinkish(lower[i - 1]) || drinkish(lower[i + 1]);
}

export interface Assembled {
  items: Item[];
  /** Each item's words, as [first, last] word numbers (from 1). Items cover the whole order between them. */
  spans: [number, number][];
}

interface Building {
  item: Partial<Omit<Pizza, "kind">> & Partial<Omit<Drink, "kind">> & { kind?: "pizza" | "drink" };
  start: number;
  hasNumber: boolean;
  hasSize: boolean;
  hasContent: boolean;
  pizzaContent: boolean;
}

/** Items from one tag per word (index 0 unused). Pure code: the same for menu tags and Jev's. */
export function assemble(words: string[], tags: Tag[], menu: Menu): Assembled {
  const lower = words.map((w) => w.toLowerCase());
  const done: Building[] = [];
  const fresh = (start: number): Building => ({ item: { styles: [], toppings: [] }, start, hasNumber: false, hasSize: false, hasContent: false, pizzaContent: false });
  let cur = fresh(1);
  let not = false;
  let quantity: "EXTRA" | "LIGHT" | undefined;
  const startNew = (at: number) => {
    done.push(cur);
    cur = fresh(at);
    not = false;
    quantity = undefined;
  };

  for (let w = 1; w <= words.length; w++) {
    const tag = tags[w] ?? "none";
    // A value spread over several words ("black olives") counts once.
    if (w > 1 && tag === tags[w - 1] && tag !== "none" && tag !== "not") continue;
    const word = lower[w - 1]!;
    const afterNot = [lower[w - 2], lower[w - 3]].some((x) => x !== undefined && menu.notWords.has(x));
    // "with olives" turns toppings back on, but not in "do not add any".
    if (menu.backOnWords.has(word) && !afterNot) not = false;
    if (tag === "none") continue;
    if (tag === "pizza") {
      if (cur.item.kind === "drink") startNew(w);
      cur.item.kind = "pizza";
      cur.hasContent = true;
      cur.pizzaContent = true;
      continue;
    }
    if (tag === "not") {
      not = true;
      continue;
    }
    if (tag === "extra" || tag === "light") {
      quantity = tag.toUpperCase() as "EXTRA" | "LIGHT";
      continue;
    }
    const e = entryOfTag(tag, menu);
    if (!e) continue;
    if (e.slot === "number") {
      // "a" right after "without" / "with" is an article, not a new item: "without a thin crust".
      const prev = lower[w - 2];
      if ((word === "a" || word === "an") && prev !== undefined && (menu.notWords.has(prev) || prev === "with")) continue;
      if (cur.hasContent || cur.hasNumber) startNew(w);
      cur.item.number = Number(e.id);
      cur.hasNumber = true;
    } else if (e.slot === "size") {
      if (cur.hasSize && cur.hasContent) startNew(w);
      cur.item.size = e.id;
      cur.hasSize = true;
    } else if (e.slot === "topping" || e.slot === "style") {
      if (cur.item.kind === "drink") startNew(w);
      cur.item.kind = "pizza";
      if (e.slot === "topping") cur.item.toppings!.push({ name: e.id, ...(quantity ? { quantity } : {}), ...(not ? { not } : {}) });
      else cur.item.styles!.push({ name: e.id, ...(not ? { not } : {}) });
      quantity = undefined;
      cur.hasContent = true;
      cur.pizzaContent = true;
    } else if (e.slot === "drink") {
      if (cur.item.drink || (cur.item.kind === "pizza" && cur.pizzaContent)) startNew(w);
      cur.item.kind = "drink";
      cur.item.drink = e.id;
      cur.hasContent = true;
    } else if (e.slot === "container") {
      cur.item.container = e.id;
    } else if (e.slot === "volume") {
      cur.item.volume = e.id;
    }
  }
  done.push(cur);

  // Keep the parts that order something; words of a dropped part go to the item before it.
  const kept = done.filter((b) => b.hasContent || b.item.container || b.item.volume);
  const items: Item[] = [];
  const spans: [number, number][] = [];
  kept.forEach((b, k) => {
    spans.push([k === 0 ? 1 : b.start, k + 1 < kept.length ? kept[k + 1]!.start - 1 : words.length]);
    items.push(finish(b));
  });
  return { items, spans };
}

function finish(b: Building): Item {
  const it = b.item;
  if (it.kind === "drink" || (!it.kind && (it.drink || it.container || it.volume))) {
    const d = emptyDrink();
    d.number = it.number ?? 1;
    if (it.size) d.size = it.size;
    if (it.drink) d.drink = it.drink;
    if (it.container) d.container = it.container;
    if (it.volume) d.volume = it.volume;
    return d;
  }
  const p = emptyPizza();
  p.number = it.number ?? 1;
  if (it.size) p.size = it.size;
  p.styles = it.styles ?? [];
  p.toppings = it.toppings ?? [];
  return p;
}
