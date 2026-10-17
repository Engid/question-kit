// Choices that may have no right answer offer "none" (some models refuse a Choice where nothing
// fits), and the methods read a "none" answer as "not given" / "no match".

import { describe, expect, test } from "bun:test";
import { type Answer, callFunction, fakeJev, NONE, pickOne, run, search } from "../packages/question-kit/core/index.ts";

const choiceAnswer = (probs: Record<string, number>): Answer => ({ type: "choice", choice: Object.entries(probs).sort((a, b) => b[1] - a[1])[0]![0], probabilities: probs });

describe("none options", () => {
  const functions = {
    order_drink: {
      does: "Order a drink.",
      params: {
        size: { kind: "one" as const, about: "the size of the drink", values: { small: "Small", large: "Large" }, default: "small" },
        milk: { kind: "one" as const, about: "the milk", values: { whole: "Whole milk", oat: "Oat milk" } },
      },
    },
  };

  test("callFunction asks every one-of-a-list argument with a none option, and reads none as not given", async () => {
    const client = fakeJev((id, q) => {
      if (id === "fn") return "order_drink";
      if (id === "order_drink.size.stated") return 0.9;
      if (id === "order_drink.size") return choiceAnswer({ small: 0.1, large: 0.1, none: 0.8 });
      if (id === "order_drink.milk") return choiceAnswer({ whole: 0.05, oat: 0.05, none: 0.9 });
      return q.type === "noul" ? 0.1 : "none";
    });
    const r = await run(client, callFunction("a latte please", functions));
    const qs = client.requests[0]!.questions;
    expect(Object.keys((qs["order_drink.milk"] as { criteria: object }).criteria)).toContain(NONE);
    expect(r.args).toEqual({ size: "small", milk: null });
    expect(r.omitted.sort()).toEqual(["milk", "size"]);
  });

  test("pickOne's close look can answer none of these, which is no match", async () => {
    const catalog = { o1: { short: "Blender" }, o2: { short: "Socks" }, o3: { short: "Lamp" } };
    const client = fakeJev((id) => {
      if (id.startsWith("gate")) return 0.9;
      if (id.startsWith("rank")) return choiceAnswer({ o1: 0.4, o2: 0.3, o3: 0.2, none: 0.1 });
      if (id === "pick") return choiceAnswer({ o1: 0.2, o2: 0.1, o3: 0.1, none: 0.6 });
      return 0.9; // every fit check says yes, so only "none" can stop it
    });
    const r = await pickOne(client, "what time do you close?", catalog, { noun: "order" });
    expect(r.value).toBeNull();
    expect(r.reason).toBe("no-fit");
  });

  test("search never ranks none as a line or picks it as a block", async () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i}`);
    const client = fakeJev((id, question) => {
      if (id === "answered") return 0.2;
      if (id === "block") return choiceAnswer({ none: 0.7, B2: 0.2, B0: 0.1 });
      const ids = Object.keys((question as { criteria: object }).criteria);
      return choiceAnswer(Object.fromEntries(ids.map((k) => [k, k === NONE ? 0.8 : k === ids[5] ? 0.15 : 0.05 / ids.length])));
    });
    const r = await search(client, lines, "find line 125", { block: 60 });
    expect(r.lines[0]!.text).toBe("line 125");
    expect(r.lines.every((l) => l.id !== NONE)).toBe(true);
    expect(r.verdict).toBe("not found");
  });
});
