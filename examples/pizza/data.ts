// Amazon's PIZZA benchmark: pizza and drink orders written by people, each with the right answer
// as a tree (EXR). Downloaded by `bun run fetch-pizza`, never committed: the dataset is CC BY-NC 4.0.
//
//   Repo:  https://github.com/amazon-science/pizza-semantic-parsing-dataset
//   Paper: Arkoudas et al. 2022, "PIZZA: A new benchmark for complex end-to-end task-oriented
//          parsing", https://arxiv.org/abs/2212.00265
//
// Dev (348 orders) and test (1,357) were collected on Mechanical Turk (paraphrases and free-form
// orders); the 2.46M training orders are synthetic and aren't used here.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const PIZZA_DIR = join(import.meta.dir, "..", "..", "data", "pizza");

/** Pinned to one commit, with SHA-256 per file, so every run scores the same data. */
export const PIZZA = {
  repo: "amazon-science/pizza-semantic-parsing-dataset",
  commit: "814d6d0f0e26e9ba5c45be281fd432dc4d069b05",
  license: "CC BY-NC 4.0",
  files: {
    "LICENSE": "41003d4a74749c0220e33dd415042164b5a1093ed401f36277234f772d22d3d0",
    "data/PIZZA_dev.json": "385d86c46ceff0864a5640f0a2c6d681ab04dea98f5bda19a53349130fcdead9",
    "data/PIZZA_test.json": "6ddec2c3299f59d8f0faec437a29f99f53c5964f17c1d0a0554a394fdfad44e6",
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

export type PizzaSplit = "dev" | "test";

export interface PizzaRow {
  /** "dev-0", "dev-1", …: the line number in the split's file. */
  id: string;
  text: string;
  /** The right answer as an EXR tree, e.g. "(ORDER (PIZZAORDER (NUMBER 1 ) (TOPPING HAM ) ) )". */
  exr: string;
  /** The same answer with the order's own words kept (TOP format): gives each item's position. */
  top: string;
  /** True when the paper's grammar-based parser (PCFG) got this order wrong. */
  pcfgError: boolean;
}

export function loadPizza(split: PizzaSplit): PizzaRow[] {
  const path = join(PIZZA_DIR, "data", `PIZZA_${split}.json`);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`${path} not found: run \`bun run fetch-pizza\` first`);
  }
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((line, i) => {
      const r = JSON.parse(line) as Record<string, string>;
      return {
        id: `${split}-${i}`,
        text: r[`${split}.SRC`] as string,
        exr: r[`${split}.EXR`] as string,
        top: r[`${split}.TOP`] as string,
        pcfgError: r[`${split}.PCFG_ERR`] === "True",
      };
    });
}

/** A catalog file: surface form → entity, e.g. "black olives" → "topping(OLIVES)". */
export function loadCatalog(name: string): [surface: string, entity: string][] {
  const text = readFileSync(join(PIZZA_DIR, "utils", "catalogs", `${name}.txt`), "utf8");
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [surface, entity] = l.split("\t");
      return [surface as string, entity as string];
    });
}
