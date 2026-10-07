// The code-only parts:
//
// 1. keywordTags: look every word up in the menu's word lists (longest match first), so "black
//    olives" → OLIVES and "a little" → light. This is all the "understanding" the code-only
//    baseline has.
// 2. assemble: turn a tag per word into items. A number starts a new item once the current one
//    has something in it; a drink after a pizza starts a new item; "no"/"without" make the
//    toppings after them unwanted until "with"/"add"; "extra"/"light" apply to the next topping.
//
// The baseline uses both. The Jev rung that tags words keeps assemble and swaps keywordTags for Jev.

import { BACK_ON_WORDS, entryOfTag, loadMenu, type Menu, NOT_WORDS, PIZZA_WORDS, type Slot, tagOf, type WordTag } from "./menu.ts";
import { type Drink, emptyDrink, emptyPizza, type Item, type Pizza } from "./order.ts";

const MAX_SURFACE_WORDS = 6;

/** A tag for every word (index 0 unused), from the menu's word lists. */
export function keywordTags(words: string[], menu: Menu = loadMenu()): WordTag[] {
  const lower = words.map((w) => w.toLowerCase());
  const tags: WordTag[] = ["", ...lower.map(() => "none")];
  let i = 0;
  while (i < lower.length) {
    let matched = 0;
    for (let len = Math.min(MAX_SURFACE_WORDS, lower.length - i); len >= 1 && !matched; len--) {
      const surface = lower.slice(i, i + len).join(" ");
      const entries = menu.surfaces.get(surface);
      if (!entries) continue;
      // "can" is a container only next to a drink or a number ("a can of coke", "two cans"), not in "can i get".
      const e = entries[0]!;
      if (e.slot === "container" && /^cans?$/.test(surface) && !nearDrink(lower, i, menu)) continue;
      for (let k = 0; k < len; k++) tags[i + k + 1] = tagOf(e.slot, e.entity);
      matched = len;
    }
    if (!matched) {
      const w = lower[i] as string;
      if (PIZZA_WORDS.has(w)) tags[i + 1] = "pizza";
      else if (NOT_WORDS.has(w)) tags[i + 1] = "not";
      matched = 1;
    }
    i += matched;
  }
  return tags;
}

function nearDrink(lower: string[], i: number, menu: Menu): boolean {
  const isDrinkish = (w: string | undefined) => !!w && (menu.surfaces.get(w)?.some((e) => e.slot === "drink" || e.slot === "number") ?? false);
  return lower[i + 1] === "of" || isDrinkish(lower[i - 1]) || isDrinkish(lower[i + 1]);
}

export interface Assembled {
  items: Item[];
  /** Each item's words, as [first, last] word ids. Items cover the whole order between them. */
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

/** Items from a tag per word (index 0 unused). Pure code; the same for keyword tags and Jev's. */
export function assemble(words: string[], tags: WordTag[], menu: Menu = loadMenu()): Assembled {
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
    const word = lower[w - 1] as string;
    const afterNot = [lower[w - 2], lower[w - 3]].some((x) => x !== undefined && NOT_WORDS.has(x));
    // "with olives" turns toppings back on, but not in "do not add any".
    if (BACK_ON_WORDS.has(word) && !afterNot) not = false;
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
    const slot: Slot = e.slot;
    if (slot === "number") {
      // "a" right after "without" / "with" is an article, not a new item: "without a thin crust".
      const prev = lower[w - 2];
      if ((word === "a" || word === "an") && prev !== undefined && (NOT_WORDS.has(prev) || prev === "with")) continue;
      if (cur.hasContent || cur.hasNumber) startNew(w);
      cur.item.number = Number(e.entity);
      cur.hasNumber = true;
    } else if (slot === "size") {
      if (cur.hasSize && cur.hasContent) startNew(w);
      cur.item.size = e.entity;
      cur.hasSize = true;
    } else if (slot === "topping" || slot === "style") {
      if (cur.item.kind === "drink") startNew(w);
      cur.item.kind = "pizza";
      if (slot === "topping") cur.item.toppings!.push({ name: e.entity, ...(quantity ? { quantity } : {}), ...(not ? { not } : {}) });
      else cur.item.styles!.push({ name: e.entity, ...(not ? { not } : {}) });
      quantity = undefined;
      cur.hasContent = true;
      cur.pizzaContent = true;
    } else if (slot === "drink") {
      if (cur.item.drink || (cur.item.kind === "pizza" && cur.pizzaContent)) startNew(w);
      cur.item.kind = "drink";
      cur.item.drink = e.entity;
      cur.hasContent = true;
    } else if (slot === "container") {
      cur.item.container = e.entity;
    } else if (slot === "volume") {
      cur.item.volume = e.entity;
    }
  }
  done.push(cur);

  // Keep the parts that order something; words of a dropped part go to the item before it.
  const kept = done.filter((b) => b.hasContent || b.item.container || b.item.volume);
  const items: Item[] = [];
  const spans: [number, number][] = [];
  kept.forEach((b, k) => {
    const start = k === 0 ? 1 : b.start;
    const end = k + 1 < kept.length ? (kept[k + 1] as Building).start - 1 : words.length;
    spans.push([start, end]);
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
