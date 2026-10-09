import { describe, expect, test } from "bun:test";
import {
  assemble,
  defineMenu,
  type SystemOneClient,
  type SystemOneRequest,
  menuTags,
  readBackOrder,
  sameItems,
  takeOrder,
  tokenize,
  wordTagOptions,
  checkQuestions,
  plural,
  wordTagQuestions,
} from "../packages/question-kit/order/index.ts";

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
function fakeJev(tags: Record<string, [string, number]>, pWrong: (id: string) => number = () => 0.05): SystemOneClient & { requests: SystemOneRequest[] } {
  const requests: SystemOneRequest[] = [];
  return {
    requests,
    async systemOne(request: SystemOneRequest) {
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
      return { model: "fake", answers } as Awaited<ReturnType<SystemOneClient["systemOne"]>>;
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
    const client = fakeJev({ more: ["extra", 0.86], cappucino: ["none", 0.4] });
    const r = await takeOrder("Can I get one large latte with more vanilla, please", CAFE, client);
    expect(client.requests.length).toBe(2);
    const state = client.requests[0]!.state as { words: Record<string, string> };
    expect(Object.keys(client.requests[0]!.questions).map((id) => state.words[`w${id.slice(5)}`])).toEqual(["can", "i", "get", "with", "more", "please"]);
    expect(r.readBack).toEqual(["1 large latte with extra vanilla"]);
    expect(r.accept).toBe(true);
    expect(r.confidence).toBeCloseTo(0.86);
    expect(Object.keys(client.requests[1]!.questions)).toEqual(["check_order", "check_i1", "check_missing"]);
  });

  test("the check decides what to read back", async () => {
    const client = fakeJev({}, (id) => (id === "check_i2" ? 0.4 : id === "check_missing" ? 0.35 : 0.05));
    const r = await takeOrder("a large latte and a muffin", CAFE, client);
    expect(r.accept).toBe(false);
    expect(r.confirm).toEqual({ items: [2], missing: true });
    expect((await takeOrder("a large latte and a muffin", CAFE, client, { readBackAt: 0.5 })).accept).toBe(true);
  });

  test("without the check, Jev's word confidence decides", async () => {
    const unsure = await takeOrder("a latte with more vanilla", CAFE, fakeJev({ more: ["extra", 0.6] }), { check: false });
    expect([unsure.accept, unsure.check]).toEqual([false, undefined]);
    expect((await takeOrder("a latte with more vanilla", CAFE, fakeJev({ more: ["extra", 0.95] }), { check: false })).accept).toBe(true);
  });

  test("pick asks nothing more when both designs agree", async () => {
    const client = fakeJev({ a: ["number_1", 0.99], large: ["size_LARGE", 0.99], latte: ["drink_LATTE", 0.99] });
    const r = await takeOrder("a large latte", CAFE, client, { design: "pick" });
    expect(r.pick).toEqual({ agreed: true });
    expect(client.requests.some((q) => "pick" in q.questions)).toBe(false);
  });

  test("an order with nothing in it is read back", async () => {
    const r = await takeOrder("hi there", CAFE, fakeJev({}));
    expect([r.items, r.accept]).toEqual([[], false]);
  });
});

describe("the pizza example's menu", () => {
  test("reads plain orders with code alone", async () => {
    const { pizzaMenu } = await import("../examples/order/pizza/menu.ts");
    const read = (text: string) => {
      const words = tokenize(text);
      return Object.values(readBackOrder(assemble(words, menuTags(words, pizzaMenu()), pizzaMenu()).items, pizzaMenu()) as Record<string, string>);
    };
    expect(read("two large pizzas with extra cheese and no onions and a diet coke")).toEqual(["2 large pizzas with extra cheese and no onions", "1 diet coke"]);
    expect(read("can i get a large deep dish with sausage and black olives and a 2 liter coke")).toEqual(["1 large deep dish pizza with sausage and black olives", "1 coke, 2 liter"]);
  });
});

describe("partial reads (changes to an order)", () => {
  const client = fakeJev({});
  test("a size alone is kept, with the number implied by its article", async () => {
    const r = await takeOrder("make that a large", CAFE, client, { check: false, partial: true });
    expect(r.items).toEqual([{ kind: "drink", number: 1, numberSaid: false, values: { size: "LARGE" }, lists: {} }]);
    // Outside a partial read, items don't say whether the number was said.
    expect((await takeOrder("make that a large", CAFE, client, { check: false })).items[0]).not.toHaveProperty("numberSaid");
  });
  test("an article after a bare number continues the part, and the number counts as said", async () => {
    const r = await takeOrder("make one of them a large", CAFE, client, { check: false, partial: true });
    expect(r.items).toEqual([{ kind: "drink", number: 1, numberSaid: true, values: { size: "LARGE" }, lists: {} }]);
    expect((await takeOrder("make that two", CAFE, client, { check: false, partial: true })).items).toMatchObject([{ number: 2, numberSaid: true }]);
  });
  test("an article after an item still starts a new one", async () => {
    const r = await takeOrder("a latte and a croissant", CAFE, client, { check: false, partial: true });
    expect(r.readBack).toEqual(["1 latte", "1 croissant"]);
  });
});

