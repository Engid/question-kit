// A pizza shop's menu for question-kit/order: pizzas in three sizes and four styles, fourteen
// toppings, and six drinks, with the ways customers say each one. It's our own small menu, written
// for this example.
//
// The numbers in this folder's README were measured on Amazon's PIZZA benchmark with the
// benchmark's own, much bigger menu (85 toppings, 23 styles, 22 drinks); that version lives in our
// research repo. The wording settings and read-backs below are the same as the measured ones.

import { defineMenu, type Menu, type MenuInput, type ReadBack } from "question-kit/order";

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
  return (cached ??= defineMenu(PIZZA_MENU));
}

/** The menu as given to `defineMenu`, for building variations on it. */
export const PIZZA_MENU: MenuInput = {
    name: "pizza and drink",
    place: "a pizza counter",
    items: {
      pizza: { words: ["pizza", "pie", "pizzas", "pies"], readBack: pizzaReadBack },
      drink: { readBack: drinkReadBack },
    },
    fields: {
      size: { items: ["pizza", "drink"], values: { SMALL: ["small", "personal"], MEDIUM: ["medium", "regular"], LARGE: ["large", "big"] } },
      style: {
        items: ["pizza"],
        label: "Pizza style",
        many: true,
        values: { THIN_CRUST: ["thin crust", "thin"], DEEP_DISH: ["deep dish", "deep-dish"], STUFFED_CRUST: ["stuffed crust"], GLUTEN_FREE: ["gluten free", "gluten-free"] },
      },
      topping: {
        items: ["pizza"],
        many: true,
        amounts: true,
        values: {
          CHEESE: ["cheese", "mozzarella"],
          PEPPERONI: ["pepperoni", "pepperonis"],
          SAUSAGE: ["sausage", "italian sausage"],
          HAM: ["ham"],
          BACON: ["bacon"],
          CHICKEN: ["chicken", "grilled chicken"],
          MUSHROOMS: ["mushroom", "mushrooms"],
          ONIONS: ["onion", "onions"],
          GREEN_PEPPERS: ["green pepper", "green peppers", "peppers"],
          BLACK_OLIVES: ["black olive", "black olives", "olives"],
          TOMATOES: ["tomato", "tomatoes"],
          SPINACH: ["spinach"],
          PINEAPPLE: ["pineapple"],
          JALAPENOS: ["jalapeno", "jalapenos", "jalapeño", "jalapeños"],
        },
      },
      drink: {
        items: ["drink"],
        names: true,
        values: {
          COKE: ["coke", "coca cola", "cokes"],
          DIET_COKE: ["diet coke", "diet cokes"],
          SPRITE: ["sprite", "sprites"],
          LEMONADE: ["lemonade", "lemonades"],
          ICED_TEA: { name: "iced tea", say: ["iced tea", "ice tea", "iced teas"] },
          WATER: ["water", "bottled water", "waters"],
        },
      },
      // "can i get…" isn't a can of anything.
      container: { items: ["drink"], onlyNearItem: ["can", "cans"], values: { CAN: ["can", "cans"], BOTTLE: ["bottle", "bottles"] } },
      volume: { items: ["drink"], label: "Drink volume", values: { TWO_LITER: { name: "2 liter", say: ["2 liter", "two liter", "2 liters"] }, TWENTY_OZ: { name: "20 oz", say: ["20 oz", "20 ounce", "twenty ounce"] } } },
    },
    wording: { wordHint: 'like "black" in "black olives", or "a" in "a little"', details: ["size", "style", "topping", "drink"] },
};
