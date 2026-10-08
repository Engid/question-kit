// The PIZZA benchmark's menu catalogs: for each kind of value (size, style, topping, drink…), every
// way customers write each value ("black olives" → OLIVES). menu.ts turns them into an order-kit menu.
//
// Amazon's PIZZA benchmark: https://github.com/amazon-science/pizza-semantic-parsing-dataset
// (Arkoudas et al. 2022, https://arxiv.org/abs/2212.00265). The catalogs are CC BY-NC 4.0, so they
// aren't copied into this repo: `bun run fetch-pizza` downloads them into data/pizza, pinned to one
// commit and checked by SHA-256.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const PIZZA_DIR = join(import.meta.dir, "..", "..", "..", "data", "pizza");

export const PIZZA = {
  repo: "amazon-science/pizza-semantic-parsing-dataset",
  commit: "814d6d0f0e26e9ba5c45be281fd432dc4d069b05",
  license: "CC BY-NC 4.0",
  files: {
    LICENSE: "41003d4a74749c0220e33dd415042164b5a1093ed401f36277234f772d22d3d0",
    "utils/catalogs/container.txt": "8bb46232603010e7b79baf390a6c3329607776bf2f89b9177b77cb55d8605446",
    "utils/catalogs/drink_volume.txt": "f0f3ef399aecc5af2f7a83b1e9611e800390678ccaa5a1bc2bc3af6156d5e394",
    "utils/catalogs/drinks.txt": "aa8e3bb9be04448e4f2511410b3a66e87bf11e046f9b21dacca6456a2767b1c7",
    "utils/catalogs/number.txt": "2fbe02097cb67b8b53497867c35cd636a526b0a37a0152d76595201b2ff822ff",
    "utils/catalogs/quant_qualifier.txt": "63ebb1cef1ec17f863d559e29cb00a2c1029504df21430d675ca025bb9098cc8",
    "utils/catalogs/size.txt": "3f9b2364fd300984b502b71c89af339a05c2b0507ede166c4f8594e0b3201d32",
    "utils/catalogs/style.txt": "000b0c07b8a4e2a19063290f0bfddf350a34e46e5280501dcbe66604cdaccf6e",
    "utils/catalogs/topping.txt": "4c032c2a62c87750738b5cc53d751a50d6447a3855d9b67baa84e6a674dbe342",
  } as Record<string, string>,
};

export type Slot = "number" | "size" | "style" | "topping" | "drink" | "container" | "volume" | "quantity";

export interface CatalogEntry {
  slot: Slot;
  /** The value in the benchmark's answers: "OLIVES", "LARGE", "2 LITER", "5". */
  entity: string;
  /** How a person would name it: "olives", "large", "2 liter". */
  label: string;
  /** Every way the catalog says customers write it, lowercase. */
  surfaces: string[];
}

export interface Catalog {
  /** In catalog order: by kind of value, then as each catalog file lists them. */
  entries: CatalogEntry[];
  get(slot: Slot, entity: string): CatalogEntry | undefined;
}

const CATALOG_FILES: [string, Slot][] = [
  ["number", "number"],
  ["size", "size"],
  ["style", "style"],
  ["topping", "topping"],
  ["drinks", "drink"],
  ["container", "container"],
  ["drink_volume", "volume"],
  ["quant_qualifier", "quantity"],
];

const LABELS: Record<string, string> = { REGULARSIZE: "regular", SEVEN_UP: "7 up", DR_PEPPER: "dr pepper", ICE_TEA: "iced tea" };

/** "volume(16.9, FLOZ)" → "16.9 FLOZ"; "topping(OLIVES)" → "OLIVES". */
function entityOf(raw: string): string {
  return raw
    .slice(raw.indexOf("(") + 1, raw.lastIndexOf(")"))
    .split(",")
    .map((p) => p.trim())
    .join(" ");
}

function labelOf(slot: Slot, entity: string): string {
  if (LABELS[entity]) return LABELS[entity];
  if (slot === "volume") {
    const [n, unit] = entity.split(" ");
    return `${n} ${{ FLOZ: "fl oz", OZ: "oz", LITER: "liter", ML: "ml" }[unit as string] ?? unit?.toLowerCase()}`;
  }
  return entity.toLowerCase().replace(/_/g, " ");
}

/** One catalog file: "black olives\ttopping(OLIVES)" per line. */
function readCatalogFile(name: string): [surface: string, raw: string][] {
  const path = join(PIZZA_DIR, "utils", "catalogs", `${name}.txt`);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`${path} not found: run \`bun run fetch-pizza\` first`);
  }
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split("\t") as [string, string]);
}

let cached: Catalog | undefined;

export function loadCatalog(): Catalog {
  if (cached) return cached;
  const entries: CatalogEntry[] = [];
  const index = new Map<string, CatalogEntry>();
  for (const [file, slot] of CATALOG_FILES) {
    for (const [surface, raw] of readCatalogFile(file)) {
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
  cached = { entries, get: (slot, entity) => index.get(`${slot}:${entity}`) };
  return cached;
}

/** Words that start "don't put this on": no peppers, hold the ham, without olives. */
export const NOT_WORDS = ["no", "not", "without", "hold", "avoid", "don't", "dont", "skip", "minus", "except", "nothing", "none", "leave", "exclude", "remove", "never"];

/** Words after which toppings are wanted again: "no ham but with olives". */
export const BACK_ON_WORDS = ["with", "add", "plus", "also", "include", "including", "and with", "topped"];
