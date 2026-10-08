// The code half of the order taker:
//
// 1. tokenize: the customer's words, lowercase.
// 2. menuTags: look every word up in the menu (longest phrase first), so "oat milk" → OAT and "a
//    little" → light. Words the menu doesn't know stay "none" (Jev is asked about those).
// 3. assemble: turn one tag per word into items:
//      a number starts a new item once the current one has something in it;
//      a value that belongs to another kind of item starts a new item ("a latte and a croissant");
//      a second name, or a second value of a one-value field, starts a new item;
//      "no"/"without" make the list values after them unwanted, until "with"/"add";
//      "extra"/"light" apply to the next list value.
//
// A tag is what one word is: a field's value ("size_LARGE"), a number ("number_2"), an amount
// ("extra"), a kind of item ("pizza"), "not", or "none".

import { type Menu, type MenuValue, safeId } from "./menu.ts";
import type { Choice, OrderItem } from "./order.ts";

export type Tag = string;

/** The longest menu phrase looked up, in words. */
const LONGEST_PHRASE = 6;

/** The tag for a menu value. */
export const tagOf = (v: Pick<MenuValue, "field" | "id">): Tag => (v.field === "amount" ? v.id.toLowerCase() : `${v.field}_${safeId(v.id)}`);

/** The menu value a tag names, if any. */
export function valueOfTag(tag: Tag, menu: Menu): MenuValue | undefined {
  const amount = menu.amounts.find((a) => a.name === tag);
  if (amount) return amount;
  if (tag.startsWith("number_")) return menu.numbers.find((v) => safeId(v.id) === tag.slice(7));
  for (const f of menu.fields) if (tag.startsWith(`${f.id}_`)) return f.values.find((v) => safeId(v.id) === tag.slice(f.id.length + 1));
  return undefined;
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
      const v = menu.phrases.get(phrase)?.[0];
      if (!v) continue;
      if (menu.field(v.field)?.onlyNearItem.has(phrase) && !nearItem(lower, i, menu)) continue;
      for (let k = 0; k < len; k++) tags[i + k + 1] = tagOf(v);
      matched = len;
    }
    if (!matched) {
      const w = lower[i]!;
      const kind = menu.kindWords.get(w);
      if (kind) tags[i + 1] = kind;
      else if (menu.notWords.has(w)) tags[i + 1] = "not";
      matched = 1;
    }
    i += matched;
  }
  return tags;
}

/** Next to a number or an item's name, or followed by "of": "two cans", "coke can", "a can of". */
function nearItem(lower: string[], i: number, menu: Menu): boolean {
  const itemish = (w: string | undefined) => !!w && (menu.phrases.get(w)?.some((v) => v.field === "number" || menu.field(v.field)?.names) ?? false);
  return lower[i + 1] === "of" || itemish(lower[i - 1]) || itemish(lower[i + 1]);
}

export interface Assembled {
  items: OrderItem[];
  /** Each item's words, as [first, last] word numbers (from 1). Items cover the whole order between them. */
  spans: [number, number][];
}

interface Building {
  kind?: string;
  number?: number;
  values: Record<string, string>;
  lists: Record<string, Choice[]>;
  start: number;
  hasNumber: boolean;
  hasContent: boolean;
}

/** Items from one tag per word (index 0 unused). Pure code: the same for the menu's tags and Jev's. */
export function assemble(words: string[], tags: Tag[], menu: Menu): Assembled {
  const lower = words.map((w) => w.toLowerCase());
  const kindIds = new Set(menu.kinds.map((k) => k.id));
  const done: Building[] = [];
  const fresh = (start: number): Building => ({ values: {}, lists: {}, start, hasNumber: false, hasContent: false });
  let cur = fresh(1);
  let not = false;
  let amount: string | undefined;
  const startNew = (at: number) => {
    done.push(cur);
    cur = fresh(at);
    not = false;
    amount = undefined;
  };
  // A value that implies another kind of item than the current one starts a new item.
  const switchTo = (kind: string | undefined, at: number) => {
    if (kind && cur.kind && cur.kind !== kind) startNew(at);
    if (kind) cur.kind = kind;
  };

  for (let w = 1; w <= words.length; w++) {
    const tag = tags[w] ?? "none";
    // A value spread over several words ("oat milk") counts once.
    if (w > 1 && tag === tags[w - 1] && tag !== "none" && tag !== "not") continue;
    const word = lower[w - 1]!;
    const afterNot = [lower[w - 2], lower[w - 3]].some((x) => x !== undefined && menu.notWords.has(x));
    // "with olives" turns list values back on, but not in "do not add any".
    if (menu.backOnWords.has(word) && !afterNot) not = false;
    if (tag === "none") continue;
    if (kindIds.has(tag)) {
      switchTo(tag, w);
      cur.hasContent = true;
      continue;
    }
    if (tag === "not") {
      not = true;
      continue;
    }
    const v = valueOfTag(tag, menu);
    if (!v) continue;
    if (v.field === "amount") {
      amount = v.id;
      continue;
    }
    if (v.field === "number") {
      // "a" right after "without" / "with" is an article, not a new item: "without a thin crust".
      const prev = lower[w - 2];
      if ((word === "a" || word === "an") && prev !== undefined && (menu.notWords.has(prev) || prev === "with")) continue;
      if (cur.hasContent || cur.hasNumber) startNew(w);
      cur.number = Number(v.id);
      cur.hasNumber = true;
      continue;
    }
    const f = menu.field(v.field)!;
    if (f.many) {
      switchTo(f.kind, w);
      (cur.lists[f.id] ??= []).push({ id: v.id, ...(f.amounts && amount ? { amount } : {}), ...(not ? { not } : {}) });
      amount = undefined;
      cur.hasContent = true;
    } else if (f.names) {
      if (cur.values[f.id] !== undefined || (f.kind && cur.kind && cur.kind !== f.kind)) startNew(w);
      if (f.kind) cur.kind = f.kind;
      cur.values[f.id] = v.id;
      cur.hasContent = true;
    } else {
      // A second value for a field the item already has ("large … small"), once it has something in it, is a new item.
      if (cur.values[f.id] !== undefined && cur.hasContent) startNew(w);
      cur.values[f.id] = v.id;
    }
  }
  done.push(cur);

  // Keep the parts that order something; words of a dropped part go to the item before it.
  const impliesKind = (b: Building) => Object.keys(b.values).some((f) => menu.field(f)?.kind);
  const kept = done.filter((b) => b.hasContent || impliesKind(b));
  const items: OrderItem[] = [];
  const spans: [number, number][] = [];
  kept.forEach((b, k) => {
    spans.push([k === 0 ? 1 : b.start, k + 1 < kept.length ? kept[k + 1]!.start - 1 : words.length]);
    items.push(finish(b, menu));
  });
  return { items, spans };
}

function finish(b: Building, menu: Menu): OrderItem {
  // The kind: as said, or implied by a value that belongs to one kind, or the menu's first kind.
  const kind = b.kind ?? Object.keys(b.values).map((f) => menu.field(f)?.kind).find(Boolean) ?? menu.kinds[0]!.id;
  const belongs = (f: string) => menu.field(f)?.items.includes(kind) ?? false;
  return {
    kind,
    number: b.number ?? 1,
    values: Object.fromEntries(Object.entries(b.values).filter(([f]) => belongs(f))),
    lists: Object.fromEntries(Object.entries(b.lists).filter(([f]) => belongs(f))),
  };
}
