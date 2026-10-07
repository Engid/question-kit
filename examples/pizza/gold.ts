// The answer key for one order, in the shapes the questions need: its items in the order the
// customer mentions them, which words belong to which item, and what each word is.
//
// The EXR tree is the authority on what was ordered. The TOP tree (the same answer with the
// customer's words kept) says where each item and each value appears in the sentence.

import type { PizzaRow } from "./data.ts";
import { loadMenu, NOT_WORDS, PIZZA_WORDS, type Slot, tagOf, type WordTag } from "./menu.ts";
import { type Item, itemKey, itemsFromExr } from "./order.ts";

export interface GoldItem {
  item: Item;
  /** Word ids (from 1) of every word inside the item in the TOP tree. */
  words: number[];
  /** Word ids that name one of its values (a topping, a size, …). */
  content: number[];
}

export interface PizzaGold {
  row: PizzaRow;
  words: string[];
  /** In the order the customer mentions them. */
  items: GoldItem[];
  /** tags[wordId]: what the word is, or undefined when the answer key doesn't say (e.g. "with"). */
  tags: (WordTag | undefined)[];
  /** itemOf[wordId]: the item (from 1) the word belongs to, 0 for words outside every item. */
  itemOf: number[];
}

const SLOT_OF_LABEL: Record<string, Slot> = {
  NUMBER: "number",
  SIZE: "size",
  STYLE: "style",
  TOPPING: "topping",
  DRINKTYPE: "drink",
  CONTAINERTYPE: "container",
  VOLUME: "volume",
  QUANTITY: "quantity",
};

interface TopValue {
  slot: Slot;
  words: number[];
  entity?: string;
}

interface TopItem {
  kind: "pizza" | "drink";
  words: number[];
  values: TopValue[];
  /** First word of each NOT node. */
  notStarts: number[];
  /** Words directly under the item (not inside a value). */
  direct: number[];
}

export function goldOf(row: PizzaRow): PizzaGold {
  const menu = loadMenu();
  const words = row.text.split(" ");
  const toks = row.top.split(/\s+/).filter(Boolean);

  // Walk the TOP tree, numbering its words.
  const items: TopItem[] = [];
  const stack: { label: string; firstWord: number }[] = [];
  let item: TopItem | undefined;
  let value: TopValue | undefined;
  let w = 0;
  for (const t of toks) {
    if (t.startsWith("(")) {
      const label = t.slice(1);
      stack.push({ label, firstWord: w + 1 });
      if (label === "PIZZAORDER" || label === "DRINKORDER") {
        item = { kind: label === "PIZZAORDER" ? "pizza" : "drink", words: [], values: [], notStarts: [], direct: [] };
        items.push(item);
      } else if (SLOT_OF_LABEL[label]) value = { slot: SLOT_OF_LABEL[label] as Slot, words: [] };
      else if (label === "NOT" && item) item.notStarts.push(w + 1);
    } else if (t === ")") {
      const closed = stack.pop();
      if (closed && SLOT_OF_LABEL[closed.label] && value && item) {
        item.values.push(value);
        value = undefined;
      }
      if (closed?.label === "PIZZAORDER" || closed?.label === "DRINKORDER") item = undefined;
    } else {
      w++;
      if (item) {
        item.words.push(w);
        if (value) value.words.push(w);
        else item.direct.push(w);
      }
    }
  }
  if (w !== words.length) throw new Error(`${row.id}: TOP has ${w} words, the order has ${words.length}`);

  // Resolve each value through the menu ("black olives" → OLIVES).
  for (const it of items) {
    for (const v of it.values) {
      const surface = v.words.map((i) => words[i - 1]?.toLowerCase()).join(" ");
      v.entity = menu.surfaces.get(surface)?.find((e) => e.slot === v.slot)?.entity;
    }
  }

  // Match TOP items to EXR items (the authority), most shared values first.
  const exrItems = itemsFromExr(row.exr);
  const factsOf = (it: Item): string[] =>
    it.kind === "pizza"
      ? [`number:${it.number}`, `size:${it.size}`, ...it.styles.map((s) => `style:${s.name}`), ...it.toppings.map((t) => `topping:${t.name}`)]
      : [`number:${it.number}`, `size:${it.size}`, `drink:${it.drink}`, `container:${it.container}`, `volume:${it.volume}`];
  const pairs: [number, number, number][] = [];
  items.forEach((ti, a) =>
    exrItems.forEach((ei, b) => {
      if ((ti.kind === "pizza") !== (ei.kind === "pizza")) return;
      const facts = new Set(factsOf(ei));
      const shared = ti.values.filter((v) => v.entity && facts.has(`${v.slot}:${v.entity}`)).length;
      pairs.push([shared, a, b]);
    }),
  );
  pairs.sort((x, y) => y[0] - x[0] || x[1] - y[1] || x[2] - y[2]);
  const exrOf = new Map<number, number>();
  const used = new Set<number>();
  for (const [, a, b] of pairs) {
    if (exrOf.has(a) || used.has(b)) continue;
    exrOf.set(a, b);
    used.add(b);
  }

  // Values the menu couldn't resolve ("hamburger" → BEEF) take what the EXR item has left over.
  items.forEach((ti, a) => {
    const ei = exrItems[exrOf.get(a) ?? -1];
    if (!ei) return;
    for (const slot of ["topping", "style", "drink", "size", "number", "volume", "container"] as Slot[]) {
      const left = valuesOf(ei, slot);
      for (const v of ti.values) if (v.slot === slot && v.entity) left.splice(left.indexOf(v.entity), left.indexOf(v.entity) >= 0 ? 1 : 0);
      for (const v of ti.values) if (v.slot === slot && !v.entity) v.entity = left.shift();
    }
  });

  // What each word is.
  const tags: (WordTag | undefined)[] = new Array(words.length + 1).fill(undefined);
  const itemOf: number[] = new Array(words.length + 1).fill(0);
  for (let i = 1; i <= words.length; i++) tags[i] = "none";
  items.forEach((ti, a) => {
    for (const i of ti.words) {
      itemOf[i] = a + 1;
      tags[i] = undefined; // words inside an item are only scored where the answer key names them
    }
    for (const i of ti.direct) if (ti.kind === "pizza" && PIZZA_WORDS.has(words[i - 1]?.toLowerCase() ?? "")) tags[i] = "pizza";
    for (const v of ti.values) if (v.entity) for (const i of v.words) tags[i] = tagOf(v.slot, v.entity);
    // "no", "without", "hold" just before a NOT node: the answer key wraps only the topping, so
    // the cue word itself is inferred from position.
    for (const start of ti.notStarts) {
      for (let i = start - 1; i >= Math.max(1, start - 4) && itemOf[i] === a + 1 && tags[i] === undefined; i--) {
        if (NOT_WORDS.has(words[i - 1]?.toLowerCase() ?? "")) tags[i] = "not";
      }
    }
  });

  const goldItems: GoldItem[] = items.map((ti, a) => ({
    item: exrItems[exrOf.get(a) ?? -1] ?? exrItems[0]!,
    words: ti.words,
    content: ti.values.flatMap((v) => v.words),
  }));
  // Sanity: every EXR item is matched to exactly one TOP item.
  if (new Set(goldItems.map((g) => itemKey(g.item))).size !== new Set(exrItems.map(itemKey)).size || items.length !== exrItems.length) {
    throw new Error(`${row.id}: TOP and EXR items don't line up`);
  }
  return { row, words, items: goldItems, tags, itemOf };
}

function valuesOf(it: Item, slot: Slot): string[] {
  if (slot === "number") return [String(it.number)];
  if (slot === "size") return it.size ? [it.size] : [];
  if (it.kind === "pizza") {
    if (slot === "topping") return it.toppings.map((t) => t.name);
    if (slot === "style") return it.styles.map((s) => s.name);
    return [];
  }
  if (slot === "drink") return it.drink ? [it.drink] : [];
  if (slot === "container") return it.container ? [it.container] : [];
  if (slot === "volume") return it.volume ? [it.volume] : [];
  return [];
}

/**
 * Which answer-key item a span of words (a strategy's item) corresponds to: the item with the most
 * value words inside the span. 0 when the span holds no value words of any item.
 */
export function goldItemOfSpan(gold: PizzaGold, span: number[]): number {
  let best = 0;
  let bestN = 0;
  gold.items.forEach((g, a) => {
    const n = g.content.filter((w) => span.includes(w)).length;
    if (n > bestN) {
      bestN = n;
      best = a + 1;
    }
  });
  return best;
}
