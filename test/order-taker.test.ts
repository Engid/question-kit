import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PIZZA_DIR, loadPizza } from "../examples/pizza/data.ts";
import { goldOf } from "../examples/pizza/gold.ts";
import { pizzaDatasetMenu } from "../examples/pizza/library.ts";
import { BACK_ON_WORDS, loadMenu, NOT_WORDS, PIZZA_WORDS } from "../examples/pizza/menu.ts";
import { askOrderCheck, askOrderPick, askWordTags, readBackOrder as labReadBack } from "../examples/pizza/questions.ts";
import { assemble as labAssemble, keywordTags } from "../examples/pizza/rules.ts";
import {
  assemble,
  checkQuestions,
  DEFAULT_WORDS,
  defineMenu,
  type JevClient,
  type JevRequest,
  menuTags,
  pickQuestion,
  readBackOrder,
  sameItems,
  takeOrder,
  tokenize,
  wordTagQuestions,
} from "../lib/pizza-order-taker/index.ts";

// A small hand-written menu: the library works without the dataset.
const MENU = defineMenu({
  sizes: { SMALL: ["small"], MEDIUM: ["medium"], LARGE: ["large", "big"] },
  styles: { THIN_CRUST: ["thin crust", "thin"], DEEP_DISH: ["deep dish"] },
  toppings: { HAM: ["ham"], OLIVES: ["olives", "black olives"], PEPPERS: ["peppers"], GREEN_PEPPERS: ["green peppers", "green pepper"], CHEESE: ["cheese"], ONIONS: ["onions", "onion"] },
  drinks: { COKE: ["coke", "cokes"], DIET_COKE: ["diet coke", "diet cokes"] },
  containers: { CAN: ["can", "cans", "can of", "cans of"] },
});

/** A fake Jev: word tags from a table (else "none", 0.95 sure), check answers from a function. */
function fakeJev(tags: Record<string, [string, number]>, pWrong: (id: string) => number = () => 0.05): JevClient & { requests: JevRequest[] } {
  const requests: JevRequest[] = [];
  return {
    requests,
    async systemOne(request) {
      requests.push(request);
      const words = (request.state as { words?: Record<string, string> }).words ?? {};
      const answers: Record<string, never> = {};
      for (const [id, q] of Object.entries(request.questions)) {
        if (q.type === "noul") {
          (answers as Record<string, unknown>)[id] = { type: "noul", noul: pWrong(id) };
          continue;
        }
        const word = id.startsWith("tag_w") ? words[`w${id.slice(5)}`] : undefined;
        const [tag, p] = (word && tags[word]) || ["none", 0.95];
        const options = Object.keys(q.criteria);
        const rest = (1 - p) / Math.max(1, options.length - 1);
        (answers as Record<string, unknown>)[id] = { type: "choice", choice: tag, confidence: p, probabilities: Object.fromEntries(options.map((o) => [o, o === tag ? p : rest])) };
      }
      return { model: "fake", answers };
    },
  };
}

describe("order taker: the code half", () => {
  test("words: lowercase, without punctuation, decimal points kept", () => {
    expect(tokenize("Two LARGE pizzas, please! And a 16.9 oz coke.")).toEqual(["two", "large", "pizzas", "please", "and", "a", "16.9", "oz", "coke"]);
  });

  test("the menu tags what it knows, longest phrase first", () => {
    const words = tokenize("can i get two large pizzas with black olives and no onions and a can of diet coke");
    const tags = menuTags(words, MENU);
    expect(tags[1]).toBe("none"); // "can i get" is not a can of something
    expect(tags.slice(4, 7)).toEqual(["number_2", "size_LARGE", "pizza"]);
    expect(tags.slice(8, 10)).toEqual(["topping_OLIVES", "topping_OLIVES"]);
    expect(tags[11]).toBe("not");
    const { items } = assemble(words, tags, MENU);
    expect(items).toEqual([
      { kind: "pizza", number: 2, size: "LARGE", styles: [], toppings: [{ name: "OLIVES" }, { name: "ONIONS", not: true }] },
      { kind: "drink", number: 1, drink: "DIET_COKE", container: "CAN" },
    ]);
  });

  test("read back the way a clerk would say it", () => {
    const items = assemble(tokenize("two large thin crust pizzas with ham and no olives"), menuTags(tokenize("two large thin crust pizzas with ham and no olives"), MENU), MENU).items;
    expect(readBackOrder(items, MENU)).toEqual({ i1: "2 large thin crust pizzas with ham and no olives" });
    expect(readBackOrder([], MENU)).toBe("nothing");
  });

  test("the same order, whatever order items and toppings come in", () => {
    const a = assemble(tokenize("a coke and a pizza with ham and olives"), menuTags(tokenize("a coke and a pizza with ham and olives"), MENU), MENU).items;
    const b = assemble(tokenize("a pizza with olives and ham and a coke"), menuTags(tokenize("a pizza with olives and ham and a coke"), MENU), MENU).items;
    expect(sameItems(a, b)).toBe(true);
    expect(sameItems(a, b.slice(0, 1))).toBe(false);
  });
});

describe("order taker: takeOrder", () => {
  test("Jev is asked only about the words the menu doesn't know, then checks the order", async () => {
    const jev = fakeJev({ more: ["extra", 0.86], coca: ["drink_COKE", 0.97], cola: ["drink_COKE", 0.97] });
    const r = await takeOrder("I need one large pizza with ham and more cheese and a coca cola", MENU, jev);
    expect(jev.requests.length).toBe(2);
    const asked = Object.keys(jev.requests[0]!.questions).map((id) => (jev.requests[0]!.state as { words: Record<string, string> }).words[`w${id.slice(5)}`]);
    expect(asked).toEqual(["i", "need", "with", "and", "more", "and", "coca", "cola"]); // "a" and "one" are numbers on the menu
    expect(r.readBack).toEqual(["1 large pizza with ham and extra cheese", "1 coke"]);
    expect(r.accept).toBe(true);
    expect(r.confidence).toBeCloseTo(0.86);
    expect(Object.keys(jev.requests[1]!.questions)).toEqual(["check_order", "check_i1", "check_i2", "check_missing"]);
  });

  test("the check decides what to read back", async () => {
    const jev = fakeJev({}, (id) => (id === "check_i2" ? 0.4 : id === "check_missing" ? 0.35 : 0.05));
    const r = await takeOrder("a large pizza with ham and a coke", MENU, jev);
    expect(r.accept).toBe(false);
    expect(r.confirm).toEqual({ items: [2], missing: true });
    const lenient = await takeOrder("a large pizza with ham and a coke", MENU, jev, { readBackAt: 0.5 });
    expect(lenient.accept).toBe(true);
  });

  test("without the check, Jev's word confidence decides", async () => {
    const unsure = await takeOrder("a pizza with ham and more cheese", MENU, fakeJev({ more: ["extra", 0.6] }), { check: false });
    expect(unsure.accept).toBe(false);
    expect(unsure.check).toBeUndefined();
    const sure = await takeOrder("a pizza with ham and more cheese", MENU, fakeJev({ more: ["extra", 0.95] }), { check: false });
    expect(sure.accept).toBe(true);
  });

  test("pick asks nothing more when both designs agree", async () => {
    const jev = fakeJev({ ham: ["topping_HAM", 0.99], pizza: ["pizza", 0.99], a: ["number_1", 0.99], large: ["size_LARGE", 0.99] });
    const r = await takeOrder("a large pizza with ham", MENU, jev, { design: "pick" });
    expect(r.pick).toEqual({ agreed: true });
    expect(jev.requests.some((q) => "pick" in q.questions)).toBe(false);
  });

  test("an order with nothing in it is read back", async () => {
    const r = await takeOrder("hi there", MENU, fakeJev({}));
    expect(r.items).toEqual([]);
    expect(r.accept).toBe(false);
  });

  test("the default cue words are the lab's", () => {
    expect(DEFAULT_WORDS.pizza).toEqual([...PIZZA_WORDS]);
    expect(DEFAULT_WORDS.not).toEqual([...NOT_WORDS]);
    expect(DEFAULT_WORDS.backOn).toEqual([...BACK_ON_WORDS]);
  });
});

// With the dataset's menu, the library must ask exactly the questions the lab measured, and its
// rules must build exactly the lab's orders. (Skipped without bun run fetch-pizza.)
const haveMenu = existsSync(join(PIZZA_DIR, "utils", "catalogs", "topping.txt"));

describe.skipIf(!haveMenu)("order taker: the same as the lab (needs bun run fetch-pizza)", () => {
  const questionsOnly = (batch: Record<string, { question: unknown }>) => JSON.stringify(Object.fromEntries(Object.entries(batch).map(([id, q]) => [id, q.question])));

  test("word questions are byte-for-byte the lab's", () => {
    const lib = pizzaDatasetMenu();
    for (const which of [[1], [1, 2, 3], [2, 5, 9, 14]]) expect(questionsOnly(wordTagQuestions(which, lib))).toBe(questionsOnly(askWordTags(which, loadMenu())));
  });

  test("check and pick questions, and their state, are byte-for-byte the lab's", () => {
    const lib = pizzaDatasetMenu();
    for (const row of loadPizza("dev").slice(0, 40)) {
      const items = goldOf(row).items.map((g) => g.item);
      expect(questionsOnly(checkQuestions(items))).toBe(questionsOnly(askOrderCheck(items)));
      expect(JSON.stringify(readBackOrder(items, lib))).toBe(JSON.stringify(labReadBack(items, loadMenu())));
      const other = items.slice(0, 1);
      for (const swap of [false, true]) {
        const a = pickQuestion(row.text, items, other, lib, swap);
        const b = askOrderPick(row.text, items, other, loadMenu(), swap);
        expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
        expect(questionsOnly(a.questions)).toBe(questionsOnly(b.questions));
      }
    }
  });

  test("on all 1,705 dev and test orders, the menu's tags and the rules match the lab's", () => {
    const lib = pizzaDatasetMenu();
    const lab = loadMenu();
    let n = 0;
    for (const row of [...loadPizza("dev"), ...loadPizza("test")]) {
      const words = tokenize(row.text);
      expect(words).toEqual(row.text.split(" "));
      const tags = menuTags(words, lib);
      expect(tags).toEqual(keywordTags(words, lab));
      expect(assemble(words, tags, lib)).toEqual(labAssemble(words, tags, lab));
      // Jev-like tags: the answer key's own tags, through both sets of rules.
      const gold = goldOf(row).tags.map((t, i) => (i === 0 ? "" : (t ?? "none")));
      expect(assemble(words, gold, lib)).toEqual(labAssemble(words, gold, lab));
      n++;
    }
    expect(n).toBe(1705);
  });
});
