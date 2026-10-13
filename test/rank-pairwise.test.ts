// rankPairwise: pairwise Choices in one request, read with a Bradley–Terry fit.
import { describe, expect, test } from "bun:test";
import { bradleyTerry, type ChoiceQuestion, fakeJev, firstOf, pairsFor, q, rankPairwise, ref, run, runAll, check } from "question-kit";

/** A fake judge that knows each item's true strength and, optionally, leans toward the first option. */
function judge(truth: Record<string, number>, lean = 0) {
  return fakeJev((_, question) => {
    if (question.type !== "choice") return 0.9;
    const [a, b] = Object.keys((question as ChoiceQuestion).criteria) as [string, string];
    const pa = 1 / (1 + Math.exp(truth[b]! - truth[a]! - lean));
    return { type: "choice", choice: pa >= 0.5 ? a : b, probabilities: { [a]: pa, [b]: 1 - pa } };
  });
}

describe("rankPairwise", () => {
  test("asks every pair once, in one request, and ranks best first", async () => {
    const items = ["c", "a", "d", "b"];
    const truth = { i1: 1, i2: 3, i3: 0, i4: 2 }; // a > b > c > d
    const client = judge(truth);
    const r = await run(client, rankPairwise(items, { query: "letters early in the alphabet" }));
    expect(client.requests).toHaveLength(1);
    expect(Object.keys(client.requests[0]!.questions)).toHaveLength(6); // 6 pairs, one order each
    expect(client.requests[0]!.state).toEqual({ items: { i1: "c", i2: "a", i3: "d", i4: "b" }, query: "letters early in the alphabet" });
    expect(r.ranked.map((x) => x.item)).toEqual(["a", "b", "c", "d"]);
    expect(r.ranked[0]!.index).toBe(1);
    expect(r.orderGap).toBeUndefined();
    expect(r.confidence).toBeGreaterThan(0.5);
    expect(r.ranked.at(-1)!.beatsNext).toBeUndefined();
  });

  test("the question points at both items and the query; the options are the two items", async () => {
    const client = judge({ i1: 0, i2: 1 });
    await run(client, rankPairwise(["x", "y"], { query: "q", bothOrders: true }));
    const qs = client.requests[0]!.questions;
    expect(qs.i1_i2).toEqual({ type: "choice", instructions: "Which is more relevant to `query`: `items.i1` or `items.i2`?", criteria: { i1: "`items.i1`", i2: "`items.i2`" } });
    expect((qs.i2_i1 as ChoiceQuestion).criteria).toEqual({ i2: "`items.i2`", i1: "`items.i1`" });
  });

  test("recovers the true strengths, up to a shift", async () => {
    const truth = { i1: -1.2, i2: 0.4, i3: 1.5, i4: -0.3, i5: 0.9 };
    const r = await run(judge(truth), rankPairwise([1, 2, 3, 4, 5], { better: "larger", prior: 0 }));
    const mean = Object.values(truth).reduce((s, x) => s + x, 0) / 5;
    for (const x of r.ranked) expect(x.strength).toBeCloseTo(truth[x.key as keyof typeof truth] - mean, 4);
  });

  test("asking both orders cancels a lean toward the first option, and orderGap measures it", async () => {
    const truth = { i1: 0, i2: 0.3, i3: 0.6 };
    const both = await run(judge(truth, 2), rankPairwise(["a", "b", "c"], { better: "better", bothOrders: true }));
    expect(both.ranked.map((x) => x.key)).toEqual(["i3", "i2", "i1"]);
    expect(both.orderGap!).toBeGreaterThan(0.5);
    // One order only: each pair asked once, and who goes first alternates.
    const one = await run(judge(truth, 2), rankPairwise(["a", "b", "c"], { better: "better", bothOrders: false }));
    expect(one.duels).toHaveLength(3);
    expect(one.orderGap).toBeUndefined();
    const firsts = [0, 0, 0];
    for (const d of one.duels) firsts[d.a]!++;
    expect(firsts).toEqual([1, 1, 1]);
  });

  test("asked once, every item goes first in about half its games", () => {
    for (const n of [6, 7, 8, 10]) {
      const firsts = new Array(n).fill(0);
      for (const [a, b] of pairsFor(n)) firsts[firstOf(a, b)]++;
      for (const f of firsts) expect(Math.abs(f - (n - 1) / 2)).toBeLessThanOrEqual(1);
    }
  });

  test("opponents limits the pairs and keeps them connected", () => {
    expect(pairsFor(4)).toEqual([[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]]);
    const p = pairsFor(10, 2);
    expect(p).toHaveLength(20);
    const games = new Array(10).fill(0);
    for (const [a, b] of p) (games[a]++, games[b]++);
    expect(games.every((g) => g === 4)).toBe(true);
  });

  test("an item that wins everything gets a finite strength", () => {
    const wins = [[0, 2, 2], [0, 0, 1], [0, 1, 0]];
    const games = [[0, 2, 2], [2, 0, 2], [2, 2, 0]];
    const s = bradleyTerry(wins, games);
    expect(s.every(Number.isFinite)).toBe(true);
    expect(s[0]).toBeGreaterThan(s[1]!);
    expect(s[1]).toBeCloseTo(s[2]!, 8);
  });

  test("a custom question, and sent alongside other tasks", async () => {
    const client = judge({ i1: 0, i2: 1 });
    const message = ref("message");
    const r = await runAll(client, {
      best: rankPairwise(["small", "large"], { question: (a, b) => q`Which size fits ${message} better: ${a} or ${b}?` }),
      urgent: check(message, "The customer is in a hurry."),
    }, { state: { message: "one large please" } });
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]!.questions["best::i1_i2"]!.instructions).toBe("Which size fits `message` better: `best.items.i1` or `best.items.i2`?");
    expect(r.best.ranked[0]!.item).toBe("large");
  });

  test("one item needs no request; no criterion is an error", async () => {
    const client = judge({});
    const r = await run(client, rankPairwise(["only"], { better: "better" }));
    expect(client.requests).toHaveLength(0);
    expect(r.ranked.map((x) => x.item)).toEqual(["only"]);
    expect(() => rankPairwise(["a", "b"])).toThrow();
  });
});
