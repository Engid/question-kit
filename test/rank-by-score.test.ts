// rankByScore: one Score per item in one request, sorted by expected level.
import { describe, expect, test } from "bun:test";
import { above, fakeJev, type ScoreQuestion, rankByScore, run } from "question-kit";

const LEVELS = ["Unrelated.", "Related.", "Partly answers it.", "Answers it exactly."];

/** A fake that answers each item's Score with the given level probabilities. */
function rater(probs: Record<string, number[]>) {
  return fakeJev((id, question) => {
    const ps = probs[id]!;
    const score = ps.reduce((s, p, i) => s + p * i, 0);
    return { type: "score", score, probabilities: Object.fromEntries((question as ScoreQuestion).criteria.map((_, i) => [String(i), ps[i] ?? 0])) };
  });
}

describe("rankByScore", () => {
  test("one Score per item, in one request, pointing at the item and the query", async () => {
    const client = rater({ i1: [1, 0, 0, 0], i2: [0, 0, 0, 1] });
    await run(client, rankByScore(["socks", "bike helmet"], { query: "bike gear", levels: LEVELS }));
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]!.state).toEqual({ items: { i1: "socks", i2: "bike helmet" }, query: "bike gear" });
    expect(client.requests[0]!.questions.i1).toEqual({ type: "score", instructions: "How relevant is `items.i1` to `query`?", criteria: LEVELS });
  });

  test("sorts by expected level, which separates items that share a most likely level", async () => {
    // i1 and i3 are both most likely level 3; i3 is surer, so it's ahead.
    const client = rater({ i1: [0, 0.3, 0, 0.7], i2: [0, 1, 0, 0], i3: [0, 0, 0.1, 0.9] });
    const r = await run(client, rankByScore(["a", "b", "c"], { query: "q", levels: LEVELS }));
    expect(r.ranked.map((x) => x.item)).toEqual(["c", "a", "b"]);
    expect(r.ranked[0]!.level).toBe(3);
    expect(r.ranked[1]!.level).toBe(3);
    expect(r.ranked[0]!.value).toBeCloseTo(2.9, 10);
    expect(r.ranked.at(-1)!.beatsNext).toBeUndefined();
    expect(r.confidence).toBeCloseTo(above([0, 0, 0.1, 0.9], [0, 0.3, 0, 0.7]), 10);
  });

  test("a question as a statement or a function; no query needed then", async () => {
    const a = rater({ i1: [0, 1], i2: [1, 0] });
    await run(a, rankByScore(["x", "y"], { question: "How easy is it to read?", levels: ["Hard.", "Easy."] }));
    expect(a.requests[0]!.questions.i1!.instructions).toBe("About `items.i1`: How easy is it to read?");
    expect(a.requests[0]!.state).toEqual({ items: { i1: "x", i2: "y" } });
    const b = rater({ i1: [0, 1], i2: [1, 0] });
    await run(b, rankByScore(["x", "y"], { question: (item) => `Is ${item} easy to read?`, levels: ["Hard.", "Easy."] }));
    expect(b.requests[0]!.questions.i2!.instructions).toBe("Is `items.i2` easy to read?");
  });

  test("above: ties count half", () => {
    expect(above([0, 1], [0, 1])).toBe(0.5);
    expect(above([0, 1], [1, 0])).toBe(1);
    expect(above([0.5, 0.5], [1, 0])).toBe(0.75);
  });

  test("needs levels and something to rate by", () => {
    expect(() => rankByScore(["a"], { query: "q", levels: ["only"] })).toThrow();
    expect(() => rankByScore(["a"], { levels: LEVELS })).toThrow();
  });
});
