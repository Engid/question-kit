// What an order holds: items, each a pizza or a drink, with menu ids for every value.

export interface Topping {
  /** A topping id from the menu: "GREEN_PEPPERS". */
  name: string;
  quantity?: "EXTRA" | "LIGHT";
  /** The customer said to leave it off. */
  not?: boolean;
}

export interface Pizza {
  kind: "pizza";
  number: number;
  size?: string;
  styles: { name: string; not?: boolean }[];
  toppings: Topping[];
}

export interface Drink {
  kind: "drink";
  number: number;
  size?: string;
  drink?: string;
  container?: string;
  volume?: string;
}

export type Item = Pizza | Drink;

export const emptyPizza = (): Pizza => ({ kind: "pizza", number: 1, styles: [], toppings: [] });
export const emptyDrink = (): Drink => ({ kind: "drink", number: 1 });

/**
 * An item read back the way a clerk would say it, with the menu's names:
 * "2 large thin crust pizzas with extra cheese and no olives", "1 diet coke, 2 liter, in a can".
 */
export function readBack(item: Item, name: (slot: string, id: string) => string): string {
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
  if (item.kind === "drink") {
    const drink = item.drink ? name("drink", item.drink) : "drink";
    const bits = [item.size ? name("size", item.size) : "", item.volume ? name("volume", item.volume) : ""].filter(Boolean);
    const container = item.container ? `in ${item.number === 1 ? "a " : ""}${name("container", item.container)}${item.number === 1 ? "" : "s"}` : "";
    return [`${item.number} ${drink}`, ...bits, container].filter(Boolean).join(", ");
  }
  const size = item.size ? `${name("size", item.size)} ` : "";
  const styles = item.styles.filter((s) => !s.not).map((s) => `${name("style", s.name)} `).join("");
  const notStyles = item.styles.filter((s) => s.not).map((s) => `not ${name("style", s.name)}`);
  const toppings = item.toppings.map(
    (t) => `${t.not ? (t.quantity === "EXTRA" ? "not extra " : "no ") : t.quantity === "EXTRA" ? "extra " : t.quantity === "LIGHT" ? "light " : ""}${name("topping", t.name)}`,
  );
  const head = `${item.number} ${size}${styles}pizza${item.number === 1 ? "" : "s"}`;
  return [head + (toppings.length ? ` with ${list(toppings)}` : ""), ...notStyles].join(", ");
}
