import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PIZZA_DIR, type PizzaRow } from "../examples/pizza/data.ts";
import { goldOf } from "../examples/pizza/gold.ts";
import { pizzaOracle } from "../examples/pizza/oracle.ts";
import { canonical, describeItem, itemsFromExr, itemsMatched, orderToExr, parseSexp, sameOrder } from "../examples/pizza/order.ts";
import { assemble, keywordTags } from "../examples/pizza/rules.ts";
import { PIZZA_ALL } from "../examples/pizza/strategies.ts";

describe("pizza orders: scoring", () => {
  test("whole-order match ignores the order of children at every level", () => {
    const a = "(ORDER (PIZZAORDER (NUMBER 1 ) (TOPPING HAM ) (TOPPING OLIVES ) ) (DRINKORDER (NUMBER 2 ) (DRINKTYPE COKE ) ) )";
    const b = "(ORDER (DRINKORDER (DRINKTYPE COKE ) (NUMBER 2 ) ) (PIZZAORDER (TOPPING OLIVES ) (NUMBER 1 ) (TOPPING HAM ) ) )";
    expect(sameOrder(a, b)).toBe(true);
    expect(sameOrder(a, b.replace("OLIVES", "ONIONS"))).toBe(false);
    expect(sameOrder(a, "(ORDER (PIZZAORDER")).toBe(false);
  });

  test("duplicate children count: two identical items are not one", () => {
    const one = "(ORDER (PIZZAORDER (NUMBER 1 ) (TOPPING HAM ) ) )";
    const two = "(ORDER (PIZZAORDER (NUMBER 1 ) (TOPPING HAM ) ) (PIZZAORDER (NUMBER 1 ) (TOPPING HAM ) ) )";
    expect(sameOrder(one, two)).toBe(false);
  });

  test("items round-trip through EXR, including negation, quantities and volumes", () => {
    const exr =
      "(ORDER (PIZZAORDER (NOT (TOPPING HAM ) ) (NOT (COMPLEX_TOPPING (QUANTITY EXTRA ) (TOPPING CHEESE ) ) ) (NUMBER 2 ) (SIZE LARGE ) (STYLE THIN_CRUST ) (NOT (STYLE DEEP_DISH ) ) (COMPLEX_TOPPING (QUANTITY LIGHT ) (TOPPING OLIVES ) ) ) (DRINKORDER (NUMBER 3 ) (DRINKTYPE COKE ) (CONTAINERTYPE CAN ) (VOLUME 16.9 FLOZ ) ) )";
    const items = itemsFromExr(exr);
    expect(sameOrder(orderToExr(items), exr)).toBe(true);
    expect(describeItem(items[0]!)).toBe("2 × large pizza: no ham, no extra cheese, light olives · thin crust, not deep dish");
    expect(canonical(parseSexp("(VOLUME 16.9 FLOZ )"))).toBe("(VOLUME 16.9 FLOZ )");
  });

  test("items right counts exact items as a multiset", () => {
    const gold = itemsFromExr("(ORDER (PIZZAORDER (NUMBER 1 ) (TOPPING HAM ) ) (DRINKORDER (NUMBER 1 ) (DRINKTYPE COKE ) ) )");
    const got = itemsFromExr("(ORDER (PIZZAORDER (NUMBER 1 ) (TOPPING HAM ) ) (DRINKORDER (NUMBER 2 ) (DRINKTYPE COKE ) ) )");
    expect(itemsMatched(got, gold)).toBe(1);
  });
});

// These need the menu (bun run fetch-pizza); they're skipped when it isn't there.
const haveMenu = existsSync(join(PIZZA_DIR, "utils", "catalogs", "topping.txt"));

// Hand-written orders in the dataset's format (not taken from the dataset).
const ROWS: PizzaRow[] = [
  {
    id: "t-0",
    text: "can i get two large pizzas with extra cheese and no onions and a diet coke",
    exr: "(ORDER (PIZZAORDER (NUMBER 2 ) (SIZE LARGE ) (COMPLEX_TOPPING (QUANTITY EXTRA ) (TOPPING CHEESE ) ) (NOT (TOPPING ONIONS ) ) ) (DRINKORDER (NUMBER 1 ) (DRINKTYPE DIET_COKE ) ) )",
    top: "(ORDER can i get (PIZZAORDER (NUMBER two ) (SIZE large ) pizzas with (COMPLEX_TOPPING (QUANTITY extra ) (TOPPING cheese ) ) and no (NOT (TOPPING onions ) ) ) and (DRINKORDER (NUMBER a ) (DRINKTYPE diet coke ) ) )",
    pcfgError: false,
  },
  {
    id: "t-1",
    text: "i want a thin crust pizza with black olives and ham please",
    exr: "(ORDER (PIZZAORDER (NUMBER 1 ) (STYLE THIN_CRUST ) (TOPPING OLIVES ) (TOPPING HAM ) ) )",
    top: "(ORDER i want (PIZZAORDER (NUMBER a ) (STYLE thin crust ) pizza with (TOPPING black olives ) and (TOPPING ham ) ) please )",
    pcfgError: false,
  },
  {
    id: "t-2",
    text: "three small pies with mushrooms one medium pie with pepperoni and two cans of sprite",
    exr: "(ORDER (PIZZAORDER (NUMBER 3 ) (SIZE SMALL ) (TOPPING MUSHROOMS ) ) (PIZZAORDER (NUMBER 1 ) (SIZE MEDIUM ) (TOPPING PEPPERONI ) ) (DRINKORDER (NUMBER 2 ) (CONTAINERTYPE CAN ) (DRINKTYPE SPRITE ) ) )",
    top: "(ORDER (PIZZAORDER (NUMBER three ) (SIZE small ) pies with (TOPPING mushrooms ) ) (PIZZAORDER (NUMBER one ) (SIZE medium ) pie with (TOPPING pepperoni ) ) and (DRINKORDER (NUMBER two ) (CONTAINERTYPE cans of ) (DRINKTYPE sprite ) ) )",
    pcfgError: false,
  },
];

describe.skipIf(!haveMenu)("pizza orders: code and plumbing (needs bun run fetch-pizza)", () => {
  test("the answer key: items in mention order, and what each word is", () => {
    const g = goldOf(ROWS[0]!);
    expect(g.items.map((i) => i.item.kind)).toEqual(["pizza", "drink"]);
    expect(g.tags[4]).toBe("number_2"); // two
    expect(g.tags[8]).toBe("extra");
    expect(g.tags[11]).toBe("not"); // "no", just before the NOT node
    expect(g.tags[12]).toBe("topping_ONIONS");
    expect(g.tags[1]).toBe("none"); // "can", outside every item
  });

  test("the keyword baseline gets the hand-written orders right", () => {
    for (const row of ROWS) {
      const words = row.text.split(" ");
      const { items } = assemble(words, keywordTags(words));
      expect(sameOrder(orderToExr(items), row.exr)).toBe(true);
    }
  });

  test("'can i get' is not a can of something", () => {
    const words = ROWS[0]!.text.split(" ");
    expect(keywordTags(words)[1]).toBe("none");
  });

  test("with perfect answers (the oracle), every strategy rebuilds the hand-written orders", async () => {
    for (const s of PIZZA_ALL) {
      for (const row of ROWS) {
        const r = await s.parse({ text: row.text, words: row.text.split(" ") }, pizzaOracle(goldOf(row)));
        expect([s.name, row.id, sameOrder(r.exr, row.exr)]).toEqual([s.name, row.id, true]);
      }
    }
  });
});
