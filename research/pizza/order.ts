// Orders: the items a strategy produces, the dataset's answer trees (EXR), and scoring.
//
// "Whole order right" is the paper's metric: the predicted tree and the answer tree are equal when
// the order of children is ignored at every level (utils/semantic_matchers.py,
// is_unordered_exact_match). Sorting children before comparing gives the same result.

export interface Topping {
  name: string;
  quantity?: "EXTRA" | "LIGHT";
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
  /** "2 LITER", "16.9 FLOZ" */
  volume?: string;
}

export type Item = Pizza | Drink;

export const emptyPizza = (): Pizza => ({ kind: "pizza", number: 1, styles: [], toppings: [] });
export const emptyDrink = (): Drink => ({ kind: "drink", number: 1 });

// ------------------------------------------------------------------ EXR trees

export type Sexp = string | { label: string; kids: Sexp[] };

/** The official EXR tokenizer: split on anything but letters, digits, ".", "_" and "-". */
export function tokenizeExr(s: string): string[] {
  return s.split(/([^a-zA-Z0-9._-])/).filter((t) => t && t.trim() && t !== ",");
}

export function parseSexp(s: string): Sexp {
  const toks = tokenizeExr(s);
  let i = 0;
  const node = (): Sexp => {
    if (toks[i] !== "(") throw new Error(`expected "(" at token ${i} in ${s}`);
    i++;
    const label = toks[i++] as string;
    const kids: Sexp[] = [];
    while (toks[i] !== ")") {
      if (i >= toks.length) throw new Error(`unbalanced: ${s}`);
      kids.push(toks[i] === "(" ? node() : (toks[i++] as string));
    }
    i++;
    return { label, kids };
  };
  const out = node();
  if (i !== toks.length) throw new Error(`trailing tokens in ${s}`);
  return out;
}

/** A tree as a string with children sorted at every level, so equal strings = equal orders. */
export function canonical(n: Sexp): string {
  if (typeof n === "string") return n;
  return `(${n.label} ${n.kids.map(canonical).sort().join(" ")} )`;
}

/** The paper's "unordered exact match" on EXR strings. A string that doesn't parse never matches. */
export function sameOrder(a: string, b: string): boolean {
  try {
    return canonical(parseSexp(a)) === canonical(parseSexp(b));
  } catch {
    return false;
  }
}

export function itemToExr(item: Item): string {
  const parts: string[] = [`(NUMBER ${item.number} )`];
  if (item.size) parts.push(`(SIZE ${item.size} )`);
  if (item.kind === "pizza") {
    for (const s of item.styles) parts.push(s.not ? `(NOT (STYLE ${s.name} ) )` : `(STYLE ${s.name} )`);
    for (const t of item.toppings) {
      const core = t.quantity ? `(COMPLEX_TOPPING (QUANTITY ${t.quantity} ) (TOPPING ${t.name} ) )` : `(TOPPING ${t.name} )`;
      parts.push(t.not ? `(NOT ${core} )` : core);
    }
    return `(PIZZAORDER ${parts.join(" ")} )`;
  }
  if (item.drink) parts.push(`(DRINKTYPE ${item.drink} )`);
  if (item.container) parts.push(`(CONTAINERTYPE ${item.container} )`);
  if (item.volume) parts.push(`(VOLUME ${item.volume} )`);
  return `(DRINKORDER ${parts.join(" ")} )`;
}

export function orderToExr(items: Item[]): string {
  return items.length ? `(ORDER ${items.map(itemToExr).join(" ")} )` : "(ORDER )";
}

const leaf = (n: Sexp | undefined): string => (typeof n === "string" ? n : "");
const kidsOf = (n: Sexp): Sexp[] => (typeof n === "string" ? [] : n.kids);

/** Items from an EXR tree (the answer key, or a prediction). */
export function itemsFromExr(exr: string): Item[] {
  const root = parseSexp(exr);
  return kidsOf(root).flatMap((n): Item[] => {
    if (typeof n === "string") return [];
    if (n.label === "PIZZAORDER") {
      const p = emptyPizza();
      for (const k of n.kids) addPizzaPart(p, k, false);
      return [p];
    }
    if (n.label === "DRINKORDER") {
      const d = emptyDrink();
      for (const k of n.kids) {
        if (typeof k === "string") continue;
        if (k.label === "NUMBER") d.number = Number(leaf(k.kids[0]));
        else if (k.label === "SIZE") d.size = leaf(k.kids[0]);
        else if (k.label === "DRINKTYPE") d.drink = leaf(k.kids[0]);
        else if (k.label === "CONTAINERTYPE") d.container = leaf(k.kids[0]);
        else if (k.label === "VOLUME") d.volume = k.kids.map(leaf).join(" ");
      }
      return [d];
    }
    return [];
  });
}

function addPizzaPart(p: Pizza, k: Sexp, not: boolean): void {
  if (typeof k === "string") return;
  if (k.label === "NOT") {
    for (const c of k.kids) addPizzaPart(p, c, true);
  } else if (k.label === "NUMBER") p.number = Number(leaf(k.kids[0]));
  else if (k.label === "SIZE") p.size = leaf(k.kids[0]);
  else if (k.label === "STYLE") p.styles.push(not ? { name: leaf(k.kids[0]), not } : { name: leaf(k.kids[0]) });
  else if (k.label === "TOPPING") p.toppings.push(not ? { name: leaf(k.kids[0]), not } : { name: leaf(k.kids[0]) });
  else if (k.label === "COMPLEX_TOPPING") {
    const q = k.kids.find((c) => typeof c !== "string" && c.label === "QUANTITY");
    const t = k.kids.find((c) => typeof c !== "string" && c.label === "TOPPING");
    const name = t ? leaf(kidsOf(t)[0]) : "";
    const quantity = (q ? leaf(kidsOf(q)[0]) : "EXTRA") as "EXTRA" | "LIGHT";
    p.toppings.push(not ? { name, quantity, not } : { name, quantity });
  }
}

export const itemKey = (item: Item): string => canonical(parseSexp(itemToExr(item)));

/** How many of the answer key's items the prediction reproduces exactly (as multisets). */
export function itemsMatched(predicted: Item[], gold: Item[]): number {
  const left = predicted.map(itemKey);
  let n = 0;
  for (const g of gold.map(itemKey)) {
    const i = left.indexOf(g);
    if (i >= 0) {
      n++;
      left.splice(i, 1);
    }
  }
  return n;
}

/**
 * An item read back the way a clerk would say it, with the menu's names:
 * "2 large thin crust pizzas with ham, extra cheese and no olives", "1 diet coke, 2 liter, in a can".
 * The whole-order check shows these to Jev next to what the customer said.
 */
export function readBack(item: Item, label: (slot: string, entity: string) => string): string {
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
  if (item.kind === "drink") {
    const name = item.drink ? label("drink", item.drink) : "drink";
    const bits = [item.size ? label("size", item.size) : "", item.volume ? label("volume", item.volume) : ""].filter(Boolean);
    const container = item.container ? `in ${item.number === 1 ? "a " : ""}${label("container", item.container)}${item.number === 1 ? "" : "s"}` : "";
    return [`${item.number} ${name}`, ...bits, container].filter(Boolean).join(", ");
  }
  const size = item.size ? `${label("size", item.size)} ` : "";
  const wanted = item.styles.filter((s) => !s.not).map((s) => `${label("style", s.name)} `).join("");
  const notStyles = item.styles.filter((s) => s.not).map((s) => `not ${label("style", s.name)}`);
  const tops = item.toppings.map((t) => `${t.not ? (t.quantity === "EXTRA" ? "not extra " : "no ") : t.quantity === "EXTRA" ? "extra " : t.quantity === "LIGHT" ? "light " : ""}${label("topping", t.name)}`);
  const head = `${item.number} ${size}${wanted}pizza${item.number === 1 ? "" : "s"}`;
  return [head + (tops.length ? ` with ${list(tops)}` : ""), ...notStyles].join(", ");
}

/** One line per item, for people: "2 × large pizza: ham, extra cheese, no olives · thin crust". */
export function describeItem(item: Item): string {
  const lower = (s: string) => s.toLowerCase().replace(/_/g, " ");
  if (item.kind === "drink") {
    const bits = [item.size, item.volume, item.drink, item.container].filter(Boolean).map((s) => lower(s as string));
    return `${item.number} × ${bits.join(" ") || "drink"}`;
  }
  const tops = item.toppings.map((t) => `${t.not ? "no " : ""}${t.quantity ? `${lower(t.quantity)} ` : ""}${lower(t.name)}`);
  const styles = item.styles.map((s) => `${s.not ? "not " : ""}${lower(s.name)}`);
  return `${item.number} × ${item.size ? `${lower(item.size)} ` : ""}pizza${tops.length ? `: ${tops.join(", ")}` : ""}${styles.length ? ` · ${styles.join(", ")}` : ""}`;
}
