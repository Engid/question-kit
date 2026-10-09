// What an order holds: items, each of one kind on the menu, with a value id for every field said.
//
//   { kind: "drink", number: 2, values: { size: "LARGE", milk: "OAT", drink: "LATTE" },
//     lists: { extras: [{ id: "SHOT", amount: "EXTRA" }, { id: "FOAM", not: true }] } }

/** One value of a field that takes several. */
export interface Choice {
  id: string;
  /** "EXTRA", "LIGHT", … for fields with amounts. */
  amount?: string;
  /** The customer said to leave it out: "no foam". */
  not?: boolean;
}

export interface OrderItem {
  /** One of the menu's kinds of item. */
  kind: string;
  number: number;
  /**
   * Only in a partial read (changes to an order already taken): whether the number was said
   * ("two", "one of them") rather than implied by an article ("a medium") or defaulted.
   */
  numberSaid?: boolean;
  /** One-value fields (including the one that names the item): field → value id. */
  values: Record<string, string>;
  /** Many-value fields: field → the values said, in order. */
  lists: Record<string, Choice[]>;
}

/**
 * The default read-back: "2 large oat lattes with extra shot and no foam". Number, the one-value
 * fields, the item's name (or its kind), then the lists.
 */
export function defaultReadBack(item: OrderItem, name: (field: string, id: string) => string, nameField?: string): string {
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
  const attrs = Object.entries(item.values)
    .filter(([f]) => f !== nameField)
    .map(([f, id]) => name(f, id));
  const head = nameField && item.values[nameField] ? name(nameField, item.values[nameField]) : item.kind;
  const choices = Object.entries(item.lists).flatMap(([f, cs]) =>
    cs.map((c) => `${c.not ? (c.amount ? `not ${c.amount.toLowerCase()} ` : "no ") : c.amount ? `${c.amount.toLowerCase()} ` : ""}${name(f, c.id)}`),
  );
  return `${[item.number, ...attrs, item.number === 1 ? head : plural(head)].join(" ")}${choices.length ? ` with ${list(choices)}` : ""}`;
}

/** A simple English plural: latte → lattes, sandwich → sandwiches, berry → berries, water → waters. */
export function plural(name: string): string {
  if (/(s|x|z|ch|sh)$/.test(name)) return `${name}es`;
  if (/[^aeiou]y$/.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}

/** The same order, ignoring the order of items and of the values in each list. */
export function sameItems(a: OrderItem[], b: OrderItem[]): boolean {
  const key = (it: OrderItem) =>
    JSON.stringify([
      it.kind,
      it.number,
      Object.entries(it.values).sort(),
      Object.entries(it.lists)
        .filter(([, cs]) => cs.length)
        .map(([f, cs]) => [f, cs.map((c) => `${c.not ? "!" : ""}${c.amount ?? ""}:${c.id}`).sort()])
        .sort(),
    ]);
  const ka = a.map(key).sort();
  const kb = b.map(key).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}
