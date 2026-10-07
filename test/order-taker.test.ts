import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  assemble,
  defineMenu,
  type JevClient,
  type JevRequest,
  menuTags,
  readBackOrder,
  sameItems,
  takeOrder,
  tokenize,
  wordTagOptions,
  checkQuestions,
  pickQuestion,
  plural,
  wordTagQuestions,
} from "../packages/order-taker/index.ts";
import { pizzaMenu, toPizzaItem } from "../examples/order-taker/pizza/menu.ts";
import { loadPizza, PIZZA_DIR } from "../research/pizza/data.ts";
import { goldOf } from "../research/pizza/gold.ts";
import { BACK_ON_WORDS, loadMenu, NOT_WORDS } from "../research/pizza/menu.ts";
import { askOrderCheck, askOrderPick, askWordTags, readBackOrder as experimentReadBack } from "../research/pizza/questions.ts";
import { assemble as experimentAssemble, keywordTags } from "../research/pizza/rules.ts";
import { DEFAULT_WORDS } from "../packages/order-taker/menu.ts";

// A small cafe: nothing in the library knows about pizza.
const CAFE = defineMenu({
  name: "coffee",
  place: "a coffee counter",
  items: { drink: {}, pastry: {} },
  fields: {
    drink: { items: ["drink"], names: true, values: { LATTE: ["latte", "lattes"], AMERICANO: ["americano", "americanos"], FLAT_WHITE: ["flat white", "flat whites"] } },
    size: { items: ["drink"], values: { SMALL: ["small"], LARGE: ["large", "big"] } },
    milk: { items: ["drink"], values: { OAT: ["oat", "oat milk"], WHOLE: ["whole milk"] } },
    extras: { items: ["drink"], many: true, amounts: true, values: { SHOT: ["shot", "espresso shot"], FOAM: ["foam"], VANILLA: ["vanilla", "vanilla syrup"] } },
    pastry: { items: ["pastry"], names: true, values: { CROISSANT: ["croissant", "croissants"], MUFFIN: ["muffin", "muffins"] } },
  },
});

/** A fake Jev: word tags from a table (else "none", 0.95 sure); check answers from a function. */
function fakeJev(tags: Record<string, [string, number]>, pWrong: (id: string) => number = () => 0.05): JevClient & { requests: JevRequest[] } {
  const requests: JevRequest[] = [];
  return {
    requests,
    async systemOne(request: JevRequest) {
      requests.push(request);
      const words = (request.state as { words?: Record<string, string> }).words ?? {};
      const answers: Record<string, unknown> = {};
      for (const [id, q] of Object.entries(request.questions)) {
        if (q.type === "noul") {
          answers[id] = { type: "noul", noul: pWrong(id) };
          continue;
        }
        const word = id.startsWith("tag_w") ? words[`w${id.slice(5)}`] : undefined;
        const [tag, p] = (word && tags[word]) || ["none", 0.95];
        const options = Object.keys(q.criteria);
        const rest = (1 - p) / Math.max(1, options.length - 1);
        answers[id] = { type: "choice", choice: tag, confidence: p, probabilities: Object.fromEntries(options.map((o) => [o, o === tag ? p : rest])) };
      }
      return { model: "fake", answers } as Awaited<ReturnType<JevClient["systemOne"]>>;
    },
  };
}

const parse = (text: string) => {
  const words = tokenize(text);
  return assemble(words, menuTags(words, CAFE), CAFE).items;
};

describe("order taker: any menu (a small cafe)", () => {
  test("words: lowercase, without punctuation, decimal points kept", () => {
    expect(tokenize("Two LARGE lattes, please! And a 16.9 oz water.")).toEqual(["two", "large", "lattes", "please", "and", "a", "16.9", "oz", "water"]);
  });

  test("names, one-value fields, lists with 'no' and 'extra', and a second kind of item", () => {
    expect(parse("a large oat latte with an extra shot and no foam and two croissants")).toEqual([
      { kind: "drink", number: 1, values: { size: "LARGE", milk: "OAT", drink: "LATTE" }, lists: { extras: [{ id: "SHOT", amount: "EXTRA" }, { id: "FOAM", not: true }] } },
      { kind: "pastry", number: 2, values: { pastry: "CROISSANT" }, lists: {} },
    ]);
  });

  test("a second name, or a value of another kind of item, starts a new item", () => {
    expect(parse("small latte americano").map((i) => i.values.drink)).toEqual(["LATTE", "AMERICANO"]);
    expect(parse("latte muffin").map((i) => i.kind)).toEqual(["drink", "pastry"]);
  });

  test("the default read-back", () => {
    expect(readBackOrder(parse("two large oat lattes with an extra shot and no foam and a muffin"), CAFE)).toEqual({
      i1: "2 large oat lattes with extra shot and no foam",
      i2: "1 muffin",
    });
    expect(readBackOrder([], CAFE)).toBe("nothing");
    expect(["sandwich", "berry", "latte", "glass"].map(plural)).toEqual(["sandwiches", "berries", "lattes", "glasses"]);
  });

  test("the questions are built from the menu", () => {
    const options = wordTagOptions(CAFE);
    expect(Object.keys(options).slice(0, 4)).toEqual(["none", "not", "extra", "light"]);
    expect(options.drink_FLAT_WHITE).toBe("Drink: flat white");
    expect(options.milk_OAT).toBe("Milk: oat (also written: oat milk)");
    const q = wordTagQuestions([3], CAFE).tag_w3!.question;
    expect(q.instructions).toBe('`order` is a customer\'s coffee order. What is `words.w3` in that order? If it is part of a longer name or phrase (like "flat" in "flat white"), answer for the whole phrase.');
    const check = checkQuestions(parse("a latte"), CAFE).check_missing!.question;
    expect(check.instructions).toContain("at a coffee counter");
    expect(check.instructions).toContain("a whole drink or pastry, or a drink, size, milk, extras or pastry detail?");
  });

  test("the same order, whatever order items and list values come in", () => {
    expect(sameItems(parse("a muffin and a latte with vanilla and foam"), parse("a latte with foam and vanilla and a muffin"))).toBe(true);
    expect(sameItems(parse("a muffin and a latte"), parse("a latte"))).toBe(false);
  });

  test("a menu can't use a name twice", () => {
    expect(() => defineMenu({ name: "x", place: "y", items: { extra: { words: ["extra"] } }, fields: {} })).toThrow(/used twice/);
    expect(() => defineMenu({ name: "x", place: "y", items: { a: {} }, fields: { number: { items: ["a"], values: {} } } })).toThrow(/reserved/);
  });
});

describe("order taker: takeOrder", () => {
  test("Jev is asked only about the words the menu doesn't know, then checks the order", async () => {
    const jev = fakeJev({ more: ["extra", 0.86], cappucino: ["none", 0.4] });
    const r = await takeOrder("Can I get one large latte with more vanilla, please", CAFE, jev);
    expect(jev.requests.length).toBe(2);
    const state = jev.requests[0]!.state as { words: Record<string, string> };
    expect(Object.keys(jev.requests[0]!.questions).map((id) => state.words[`w${id.slice(5)}`])).toEqual(["can", "i", "get", "with", "more", "please"]);
    expect(r.readBack).toEqual(["1 large latte with extra vanilla"]);
    expect(r.accept).toBe(true);
    expect(r.confidence).toBeCloseTo(0.86);
    expect(Object.keys(jev.requests[1]!.questions)).toEqual(["check_order", "check_i1", "check_missing"]);
  });

  test("the check decides what to read back", async () => {
    const jev = fakeJev({}, (id) => (id === "check_i2" ? 0.4 : id === "check_missing" ? 0.35 : 0.05));
    const r = await takeOrder("a large latte and a muffin", CAFE, jev);
    expect(r.accept).toBe(false);
    expect(r.confirm).toEqual({ items: [2], missing: true });
    expect((await takeOrder("a large latte and a muffin", CAFE, jev, { readBackAt: 0.5 })).accept).toBe(true);
  });

  test("without the check, Jev's word confidence decides", async () => {
    const unsure = await takeOrder("a latte with more vanilla", CAFE, fakeJev({ more: ["extra", 0.6] }), { check: false });
    expect([unsure.accept, unsure.check]).toEqual([false, undefined]);
    expect((await takeOrder("a latte with more vanilla", CAFE, fakeJev({ more: ["extra", 0.95] }), { check: false })).accept).toBe(true);
  });

  test("pick asks nothing more when both designs agree", async () => {
    const jev = fakeJev({ a: ["number_1", 0.99], large: ["size_LARGE", 0.99], latte: ["drink_LATTE", 0.99] });
    const r = await takeOrder("a large latte", CAFE, jev, { design: "pick" });
    expect(r.pick).toEqual({ agreed: true });
    expect(jev.requests.some((q) => "pick" in q.questions)).toBe(false);
  });

  test("an order with nothing in it is read back", async () => {
    const r = await takeOrder("hi there", CAFE, fakeJev({}));
    expect([r.items, r.accept]).toEqual([[], false]);
  });
});

// The pizza example (examples/order-taker/pizza) must ask exactly the questions the pizza experiment
// measured and build exactly its orders. Skipped without `bun run fetch-pizza`.
const haveMenu = existsSync(join(PIZZA_DIR, "utils", "catalogs", "topping.txt"));

describe.skipIf(!haveMenu)("pizza order taker: the same as the experiment (needs bun run fetch-pizza)", () => {
  const questionsOnly = (batch: Record<string, { question: unknown }>) => JSON.stringify(Object.fromEntries(Object.entries(batch).map(([id, q]) => [id, q.question])));

  test("the default cue words are the experiment's", () => {
    expect(DEFAULT_WORDS.not).toEqual([...NOT_WORDS]);
    expect(DEFAULT_WORDS.backOn).toEqual([...BACK_ON_WORDS]);
  });

  test("word questions are byte-for-byte the experiment's", () => {
    for (const which of [[1], [1, 2, 3], [2, 5, 9, 14]]) expect(questionsOnly(wordTagQuestions(which, pizzaMenu()))).toBe(questionsOnly(askWordTags(which, loadMenu())));
  });

  test("on all 1,705 dev and test orders: the same tags, orders, check and pick questions", () => {
    const menu = pizzaMenu();
    const catalog = loadMenu();
    let n = 0;
    for (const row of [...loadPizza("dev"), ...loadPizza("test")]) {
      const words = tokenize(row.text);
      expect(words).toEqual(row.text.split(" "));
      const tags = menuTags(words, menu);
      expect(tags).toEqual(keywordTags(words, catalog));
      const ours = assemble(words, tags, menu);
      const theirs = experimentAssemble(words, tags, catalog);
      expect(ours.items.map(toPizzaItem)).toEqual(theirs.items);
      expect(ours.spans).toEqual(theirs.spans);
      // Jev-like tags: the answer key's own, through both sets of rules.
      const gold = goldOf(row).tags.map((t, i) => (i === 0 ? "" : (t ?? "none")));
      expect(assemble(words, gold, menu).items.map(toPizzaItem)).toEqual(experimentAssemble(words, gold, catalog).items);
      // The check and pick questions, and their state, for the order built.
      const items = ours.items.map(toPizzaItem);
      expect(questionsOnly(checkQuestions(ours.items, menu))).toBe(questionsOnly(askOrderCheck(items)));
      expect(JSON.stringify(readBackOrder(ours.items, menu))).toBe(JSON.stringify(experimentReadBack(items, catalog)));
      const swap = n % 2 === 0;
      const a = pickQuestion(row.text, ours.items, ours.items.slice(0, 1), menu, swap);
      const b = askOrderPick(row.text, items, items.slice(0, 1), catalog, swap);
      expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
      expect(questionsOnly(a.questions)).toBe(questionsOnly(b.questions));
      n++;
    }
    expect(n).toBe(1705);
  });
});
