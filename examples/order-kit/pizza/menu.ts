// The pizza shop's menu for packages/order-kit: the menu of Amazon's PIZZA benchmark, with every
// size, style, topping, drink, container and volume, and every way its catalogs say customers name
// them (85 toppings, 23 styles, 22 drinks…). The catalogs are downloaded by `bun run fetch-pizza`
// (see catalog.ts).
//
// The wording settings and read-backs below are the ones the pizza experiment measured, so this
// menu asks Jev exactly the questions behind its numbers.

import { defineMenu, type Menu, type ReadBack } from "@question-kit/order-kit";
import { BACK_ON_WORDS, loadCatalog, NOT_WORDS, type Slot } from "./catalog.ts";

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** "2 large thin crust pizzas with extra cheese, no olives and ham, not deep dish" */
export const pizzaReadBack: ReadBack = (item, name) => {
  const size = item.values.size ? `${name("size", item.values.size)} ` : "";
  const styles = item.lists.style ?? [];
  const wanted = styles.filter((s) => !s.not).map((s) => `${name("style", s.id)} `).join("");
  const notStyles = styles.filter((s) => s.not).map((s) => `not ${name("style", s.id)}`);
  const toppings = (item.lists.topping ?? []).map(
    (t) => `${t.not ? (t.amount === "EXTRA" ? "not extra " : "no ") : t.amount === "EXTRA" ? "extra " : t.amount === "LIGHT" ? "light " : ""}${name("topping", t.id)}`,
  );
  const head = `${item.number} ${size}${wanted}pizza${item.number === 1 ? "" : "s"}`;
  return [head + (toppings.length ? ` with ${list(toppings)}` : ""), ...notStyles].join(", ");
};

/** "1 diet coke, 2 liter, in a can" */
export const drinkReadBack: ReadBack = (item, name) => {
  const v = item.values;
  const drink = v.drink ? name("drink", v.drink) : "drink";
  const bits = [v.size ? name("size", v.size) : "", v.volume ? name("volume", v.volume) : ""].filter(Boolean);
  const container = v.container ? `in ${item.number === 1 ? "a " : ""}${name("container", v.container)}${item.number === 1 ? "" : "s"}` : "";
  return [`${item.number} ${drink}`, ...bits, container].filter(Boolean).join(", ");
};

let cached: Menu | undefined;

export function pizzaMenu(): Menu {
  if (cached) return cached;
  const catalog = loadCatalog();
  const values = (slot: Slot) => Object.fromEntries(catalog.entries.filter((e) => e.slot === slot).map((e) => [e.entity, { name: e.label, say: e.surfaces }]));
  cached = defineMenu({
    name: "pizza and drink",
    place: "a pizza counter",
    items: {
      pizza: { words: ["pizza", "pie", "pizzas", "pies"], readBack: pizzaReadBack },
      drink: { readBack: drinkReadBack },
    },
    fields: {
      size: { items: ["pizza", "drink"], values: values("size") },
      style: { items: ["pizza"], label: "Pizza style", many: true, values: values("style") },
      topping: { items: ["pizza"], many: true, amounts: true, values: values("topping") },
      drink: { items: ["drink"], names: true, values: values("drink") },
      // "can i get…" isn't a can of anything.
      container: { items: ["drink"], onlyNearItem: ["can", "cans"], values: values("container") },
      volume: { items: ["drink"], label: "Drink volume", values: values("volume") },
    },
    numbers: values("number"),
    amounts: {
      EXTRA: { describe: "More of a topping: extra, lots of, heavy on", say: catalog.get("quantity", "EXTRA")?.surfaces ?? [] },
      LIGHT: { describe: "Less of a topping: light, a little, not much", say: catalog.get("quantity", "LIGHT")?.surfaces ?? [] },
    },
    words: { not: [...NOT_WORDS], backOn: [...BACK_ON_WORDS] },
    wording: { wordHint: 'like "black" in "black olives", or "a" in "a little"', details: ["size", "style", "topping", "drink"] },
  });
  return cached;
}
