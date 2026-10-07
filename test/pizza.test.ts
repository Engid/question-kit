import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PIZZA_DIR, type PizzaRow } from "../research/pizza/data.ts";
import { goldOf } from "../research/pizza/gold.ts";
import { pizzaOracle } from "../research/pizza/oracle.ts";
import { loadMenu } from "../research/pizza/menu.ts";
import { canonical, describeItem, itemsFromExr, itemsMatched, orderToExr, parseSexp, readBack, sameOrder } from "../research/pizza/order.ts";
import { askItem, askOrderCheck, askWordTags, candidateEntries, ORDER_CHECK, PIZZA_QUESTION_SETS, readBackOrder, topOptions, WORD_TAG } from "../research/pizza/questions.ts";
import { assemble, keywordTags } from "../research/pizza/rules.ts";
import { gatesOf, getPizzaStrategy, PIZZA_ALL } from "../research/pizza/strategies.ts";
import { MockJevClient, peakedChoice } from "../research/lab/jev/mock.ts";
import type { QuestionMeta } from "../research/lab/calls.ts";

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

  test("an item read back the way a clerk would say it", () => {
    const [pizza, drink] = itemsFromExr(
      "(ORDER (PIZZAORDER (NUMBER 2 ) (SIZE LARGE ) (STYLE THIN_CRUST ) (COMPLEX_TOPPING (QUANTITY EXTRA ) (TOPPING CHEESE ) ) (NOT (TOPPING OLIVES ) ) (TOPPING HAM ) ) (DRINKORDER (NUMBER 1 ) (DRINKTYPE DIET_COKE ) (CONTAINERTYPE CAN ) ) )",
    );
    const label = (_slot: string, e: string) => e.toLowerCase().replace(/_/g, " ");
    expect(readBack(pizza!, label)).toBe("2 large thin crust pizzas with extra cheese, no olives and ham");
    expect(readBack(drink!, label)).toBe("1 diet coke, in a can");
    expect(topOptions({ a: 0.6, b: 0.395, c: 0.004, d: 0.001 })).toEqual(["a", "b"]);
    expect(topOptions({ a: 0.5, b: 0.2, c: 0.1, d: 0.1, e: 0.05, f: 0.05 })).toEqual(["a", "b", "c", "d", "e"]);
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

  test("the questions the earlier runs recorded are unchanged, so their cached answers still apply", () => {
    // sha256 of the question batches as first recorded (2026-10-05). A change here means every
    // recorded answer for that design is a cache miss, and re-running it costs money.
    const menu = loadMenu();
    const h = (x: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 16);
    expect(h(askWordTags([1, 2, 3], menu))).toBe("afa0aadf8eb2924b");
    expect(h(askWordTags([1, 2], menu, { nested: true }))).toBe("6b85daf5b73d23c6");
    expect(h(askWordTags([1, 2], menu, { wording: "bare" }))).toBe("950bd9d7877c8f47");
    expect(h(askItem(1, [1, 2, 3], menu))).toBe("8f74fa12a97e1ff9");
    expect(h(askItem(2, [4, 5], menu, "named", candidateEntries("extra cheese and green peppers", menu)))).toBe("7344cdab51e9328c");
  });

  test("structured criteria: every word-tag option says what it is and gives examples", () => {
    const q = askWordTags([1], loadMenu(), { examples: true }).tag_w1!.question;
    if (q.type !== "choice") throw new Error("expected a choice");
    expect(Object.keys(q.criteria)).toEqual(Object.keys((askWordTags([1], loadMenu()).tag_w1!.question as typeof q).criteria));
    for (const c of Object.values(q.criteria)) expect(c).toMatchObject({ what: expect.any(String), examples: expect.any(Array) });
    expect(q.criteria.topping_GREEN_PEPPERS).toMatchObject({ not_for: expect.stringContaining('plain "peppers"') });
  });

  test("follow-up: only the words Jev was unsure of are asked again, with fewer options", async () => {
    const row = ROWS[1]!;
    const gold = goldOf(row);
    // Right answers, but only 0.6 sure about "black" (w8); sure about everything else.
    const jev = new MockJevClient((id, q, req) => {
      const meta = (req.meta as Record<string, QuestionMeta>)[id]!;
      const right = (PIZZA_QUESTION_SETS[meta.set]!.expected(meta, gold) as string | undefined) ?? "none";
      if (q.type !== "choice") return undefined;
      return peakedChoice(Object.keys(q.criteria), right, meta.set === WORD_TAG && meta.word === 8 ? 0.6 : 0.95);
    });
    const r = await getPizzaStrategy("jev-tags-words/follow-up").parse({ text: row.text, words: row.text.split(" ") }, jev);
    const second = r.calls.find((c) => c.title.startsWith("follow-up"))!;
    expect(Object.keys(second.request.questions)).toEqual(["tag2_w8"]);
    const options = Object.keys((second.request.questions.tag2_w8 as { criteria: object }).criteria);
    expect(options).toContain("topping_OLIVES");
    expect(options).toContain("none");
    expect(options.length).toBeLessThanOrEqual(6);
    expect(sameOrder(r.exr, row.exr)).toBe(true);
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  test("order check: the answer key says which parts of a wrong order are wrong", () => {
    const gold = goldOf(ROWS[0]!);
    // Rung-0 style mistake: the coke is missing and the pizza lost its size.
    const wrong = itemsFromExr("(ORDER (PIZZAORDER (NUMBER 2 ) (COMPLEX_TOPPING (QUANTITY EXTRA ) (TOPPING CHEESE ) ) (NOT (TOPPING ONIONS ) ) ) )");
    const batch = askOrderCheck(wrong);
    const expected = Object.fromEntries(Object.entries(batch).map(([id, q]) => [id, PIZZA_QUESTION_SETS[ORDER_CHECK]!.expected(q.meta, gold)]));
    expect(expected).toEqual({ check_order: true, check_i1: true, check_missing: true });
    const right = askOrderCheck(gold.items.map((g) => g.item));
    expect(Object.values(right).map((q) => PIZZA_QUESTION_SETS[ORDER_CHECK]!.expected(q.meta, gold))).toEqual([false, false, false, false]);
    expect(readBackOrder(gold.items.map((g) => g.item), loadMenu())).toEqual({ i1: "2 large pizzas with extra cheese and no onions", i2: "1 diet coke" });
  });

  test("check and pick strategies report gates; pick asks nothing more when the designs agree", async () => {
    const row = ROWS[0]!;
    const checked = await getPizzaStrategy("keywords+check").parse({ text: row.text, words: row.text.split(" ") }, pizzaOracle(goldOf(row)));
    expect(checked.check!.whole).toBeLessThan(0.5);
    expect(gatesOf(checked)["check, each part: all P(wrong) < 0.5"]).toBe(true);
    const picked = await getPizzaStrategy("pick-dial-1-or-3").parse({ text: row.text, words: row.text.split(" ") }, pizzaOracle(goldOf(row)));
    expect(picked.agreed).toBe(true);
    expect(picked.calls.some((c) => c.title.startsWith("pick"))).toBe(false);
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
