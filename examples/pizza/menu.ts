// The menu, built from the PIZZA catalogs: every size, style, topping, drink, container and volume,
// with the words customers use for it ("black olives" → OLIVES). The catalogs are the dataset's own
// lists, so both the keyword baseline and Jev's options come from the same menu.

import { loadCatalog } from "./data.ts";

export type Slot = "number" | "size" | "style" | "topping" | "drink" | "container" | "volume" | "quantity";

export interface MenuEntry {
  slot: Slot;
  /** The value in the answer tree: "OLIVES", "LARGE", "2 LITER", "5". */
  entity: string;
  /** How a person would name it: "olives", "large", "2 liter". */
  label: string;
  /** Every way the catalog says customers write it, including the label. */
  surfaces: string[];
}

const CATALOG_SLOTS: [string, Slot][] = [
  ["number", "number"],
  ["size", "size"],
  ["style", "style"],
  ["topping", "topping"],
  ["drinks", "drink"],
  ["container", "container"],
  ["drink_volume", "volume"],
  ["quant_qualifier", "quantity"],
];

const LABEL_OVERRIDES: Record<string, string> = { REGULARSIZE: "regular", SEVEN_UP: "7 up", DR_PEPPER: "dr pepper", ICE_TEA: "iced tea" };

/** "volume(16.9, FLOZ)" → "16.9 FLOZ"; "topping(OLIVES)" → "OLIVES". */
function entityOf(raw: string): string {
  const inner = raw.slice(raw.indexOf("(") + 1, raw.lastIndexOf(")"));
  return inner
    .split(",")
    .map((p) => p.trim())
    .join(" ");
}

function labelOf(slot: Slot, entity: string): string {
  if (LABEL_OVERRIDES[entity]) return LABEL_OVERRIDES[entity] as string;
  if (slot === "volume") {
    const [n, unit] = entity.split(" ");
    return `${n} ${{ FLOZ: "fl oz", OZ: "oz", LITER: "liter", ML: "ml" }[unit as string] ?? unit?.toLowerCase()}`;
  }
  return entity.toLowerCase().replace(/_/g, " ");
}

export interface Menu {
  entries: MenuEntry[];
  bySlot: Record<Slot, MenuEntry[]>;
  get(slot: Slot, entity: string): MenuEntry | undefined;
  /** Surface form (lowercase, single spaces) → the entries it can mean. */
  surfaces: Map<string, MenuEntry[]>;
}

let cached: Menu | undefined;

export function loadMenu(): Menu {
  if (cached) return cached;
  const entries: MenuEntry[] = [];
  const index = new Map<string, MenuEntry>();
  for (const [file, slot] of CATALOG_SLOTS) {
    for (const [surface, raw] of loadCatalog(file)) {
      const entity = entityOf(raw);
      const key = `${slot}:${entity}`;
      let e = index.get(key);
      if (!e) {
        e = { slot, entity, label: labelOf(slot, entity), surfaces: [] };
        index.set(key, e);
        entries.push(e);
      }
      const s = surface.toLowerCase().replace(/\s+/g, " ").trim();
      if (!e.surfaces.includes(s)) e.surfaces.push(s);
    }
  }
  const bySlot = Object.fromEntries(CATALOG_SLOTS.map(([, slot]) => [slot, entries.filter((e) => e.slot === slot)])) as Record<Slot, MenuEntry[]>;
  // Numbers in numeric order; everything else as the catalog lists it.
  bySlot.number.sort((a, b) => Number(a.entity) - Number(b.entity));
  const surfaces = new Map<string, MenuEntry[]>();
  for (const e of entries) for (const s of e.surfaces) surfaces.set(s, [...(surfaces.get(s) ?? []), e]);
  cached = { entries, bySlot, get: (slot, entity) => index.get(`${slot}:${entity}`), surfaces };
  return cached;
}

/** Other ways to say it, besides the label (at most `max`). */
export function aliasesOf(e: MenuEntry, max = 4): string[] {
  const stem = (s: string) => s.replace(/s$/, "");
  const seen = new Set([stem(e.label)]);
  const out: string[] = [];
  // Shortest first, and no spaced-out hyphen variants ("1 - liters").
  // Skip surfaces the catalog gives to two entries of the same kind (it lists "seven and a half
  // fl ounces" under both 7.5 and 16.9 fl oz).
  const ambiguous = (s: string) => (loadMenu().surfaces.get(s)?.filter((o) => o.slot === e.slot).length ?? 0) > 1;
  for (const s of [...e.surfaces].filter((x) => !x.includes(" - ") && !ambiguous(x)).sort((a, b) => a.length - b.length)) {
    if (seen.has(stem(s))) continue;
    seen.add(stem(s));
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Menu entries a customer could confuse with this one because their names share all its words:
 * for "peppers", green peppers, red peppers, banana peppers… Spelled out in questions so Jev
 * answers about this exact entry.
 */
export function lookalikesOf(e: MenuEntry, menu: Menu): MenuEntry[] {
  const words = (s: string) => s.split(" ").map((w) => w.replace(/s$/, ""));
  const mine = words(e.label);
  return menu.bySlot[e.slot].filter((o) => o !== e && mine.every((w) => words(o.label).includes(w)));
}

/** A safe option or question id for an entity: "16.9 FLOZ" → "16_9_FLOZ". */
export function idOf(entity: string): string {
  return entity.replace(/[^A-Za-z0-9]+/g, "_");
}

/**
 * What a single word of an order is, as one id: a menu entry ("topping_OLIVES", "number_2",
 * "size_LARGE"), "extra" / "light", or one of the cue words below.
 */
export type WordTag = string;

export const tagOf = (slot: Slot, entity: string): WordTag => (slot === "quantity" ? entity.toLowerCase() : `${slot}_${idOf(entity)}`);

/** The word for the pizza itself. */
export const PIZZA_WORDS = new Set(["pizza", "pizzas", "pie", "pies"]);

/** Words that start "don't put this on": no peppers, hold the ham, without olives. */
export const NOT_WORDS = new Set(["no", "not", "without", "hold", "avoid", "don't", "dont", "skip", "minus", "except", "nothing", "none", "leave", "exclude", "remove", "never"]);

/** Words after which toppings are wanted again: "no ham but with olives". */
export const BACK_ON_WORDS = new Set(["with", "add", "plus", "also", "include", "including", "and with", "topped"]);

/** Which menu entry a tag names, if any. */
export function entryOfTag(tag: WordTag, menu: Menu): MenuEntry | undefined {
  if (tag === "extra" || tag === "light") return menu.get("quantity", tag.toUpperCase());
  const i = tag.indexOf("_");
  if (i < 0) return undefined;
  const slot = tag.slice(0, i) as Slot;
  return menu.bySlot[slot]?.find((e) => idOf(e.entity) === tag.slice(i + 1));
}
