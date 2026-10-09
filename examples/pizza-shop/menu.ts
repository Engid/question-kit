// The pizza shop's menu: the order example's pizza menu (sizes, styles, toppings, drinks, and the
// ways customers say them), plus prices for the register.

import { defineMenu, type Menu, type OrderItem, plural, type ReadBack } from "question-kit/order";
import { PIZZA_MENU } from "../order/pizza/menu.ts";

/** "2 diet cokes, in cans" (the order example's read-back, with the drink's name in the plural). */
const drinkReadBack: ReadBack = (item, name) => {
  const v = item.values;
  const drink = v.drink ? name("drink", v.drink) : "drink";
  const bits = [v.size ? name("size", v.size) : "", v.volume ? name("volume", v.volume) : ""].filter(Boolean);
  const container = v.container ? `in ${item.number === 1 ? "a " : ""}${name("container", v.container)}${item.number === 1 ? "" : "s"}` : "";
  return [`${item.number} ${item.number === 1 ? drink : plural(drink)}`, ...bits, container].filter(Boolean).join(", ");
};

let cached: Menu | undefined;

/** The order example's pizza menu, with this shop's drink read-back. */
export function pizzaMenu(): Menu {
  return (cached ??= defineMenu({ ...PIZZA_MENU, items: { ...PIZZA_MENU.items, drink: { ...PIZZA_MENU.items.drink, readBack: drinkReadBack } } }));
}

/** Prices in dollars. Anything the menu knows and this table doesn't is free. */
export const PRICES = {
  pizza: { SMALL: 9.99, MEDIUM: 12.99, LARGE: 14.99 },
  pizzaDefaultSize: "MEDIUM",
  topping: 1.5,
  style: { STUFFED_CRUST: 2, GLUTEN_FREE: 2 },
  drink: { COKE: 2.49, DIET_COKE: 2.49, SPRITE: 2.49, LEMONADE: 2.99, ICED_TEA: 2.99, WATER: 1.99 },
  volume: { TWO_LITER: 3.99, TWENTY_OZ: 2.49 },
} as const;

/** The price of one item, times its number. */
export function priceOf(item: OrderItem): number {
  let each = 0;
  if (item.kind === "pizza") {
    each += PRICES.pizza[(item.values.size ?? PRICES.pizzaDefaultSize) as keyof typeof PRICES.pizza] ?? 0;
    for (const t of item.lists.topping ?? []) if (!t.not && t.id !== "CHEESE") each += PRICES.topping * (t.amount === "EXTRA" ? 2 : 1);
    for (const s of item.lists.style ?? []) if (!s.not) each += PRICES.style[s.id as keyof typeof PRICES.style] ?? 0;
  } else {
    each += item.values.volume ? (PRICES.volume[item.values.volume as keyof typeof PRICES.volume] ?? 0) : (PRICES.drink[item.values.drink as keyof typeof PRICES.drink] ?? 0);
  }
  return Math.round(each * item.number * 100) / 100;
}

/** What the agent says about each part of the menu when asked ("what crusts do you have?"). */
export function menuAnswers(): { sizes: string; crusts: string; toppings: string; drinks: string } {
  const m = pizzaMenu();
  const names = (field: string) => m.field(field)?.values.map((v) => v.name) ?? [];
  const price = (x: number) => `$${x.toFixed(2)}`;
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
  const styles = names("style").map((n) => {
    const id = m.field("style")!.values.find((v) => v.name === n)!.id as keyof typeof PRICES.style;
    return PRICES.style[id] ? `${n} (${price(PRICES.style[id])} more)` : n;
  });
  const drinks = names("drink").map((n) => {
    const id = m.field("drink")!.values.find((v) => v.name === n)!.id as keyof typeof PRICES.drink;
    return `${n} (${price(PRICES.drink[id] ?? 0)})`;
  });
  return {
    sizes: `Pizzas come small (${price(PRICES.pizza.SMALL)}), medium (${price(PRICES.pizza.MEDIUM)}) or large (${price(PRICES.pizza.LARGE)}). Drinks are a can, 20 oz or 2 liter.`,
    crusts: `We do ${list(styles)}, or regular crust.`,
    toppings: `Toppings are ${list(names("topping"))}: ${price(PRICES.topping)} each, double for extra, and cheese is free.`,
    drinks: `We have ${list(drinks)}, as a can, 20 oz (${price(PRICES.volume.TWENTY_OZ)}) or 2 liter (${price(PRICES.volume.TWO_LITER)}).`,
  };
}

/** The menu as the register shows it: one line per group, with prices. */
export function menuLines(): string[] {
  const m = pizzaMenu();
  const names = (field: string) => m.field(field)?.values.map((v) => v.name) ?? [];
  const price = (x: number) => `$${x.toFixed(2)}`;
  const styles = names("style").map((n) => {
    const id = m.field("style")!.values.find((v) => v.name === n)!.id as keyof typeof PRICES.style;
    return PRICES.style[id] ? `${n} (+${price(PRICES.style[id])})` : n;
  });
  const drinks = names("drink").map((n) => {
    const id = m.field("drink")!.values.find((v) => v.name === n)!.id as keyof typeof PRICES.drink;
    return `${n} ${price(PRICES.drink[id] ?? 0)}`;
  });
  return [
    `Pizzas: small ${price(PRICES.pizza.SMALL)}, medium ${price(PRICES.pizza.MEDIUM)}, large ${price(PRICES.pizza.LARGE)}`,
    `Styles: ${styles.join(", ")}`,
    `Toppings (${price(PRICES.topping)} each, extra is double; cheese comes free): ${names("topping").join(", ")}`,
    `Drinks: ${drinks.join(", ")}`,
    `Sizes for drinks: 2 liter ${price(PRICES.volume.TWO_LITER)}, 20 oz ${price(PRICES.volume.TWENTY_OZ)}, or a can`,
  ];
}
