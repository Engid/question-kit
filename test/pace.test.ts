// Pacing: gaps, jitter and the token budget, on a fake clock.

import { describe, expect, test } from "bun:test";
import { estimateTokens, fakeJev, type JevRequest, pacedJev } from "../packages/core/index.ts";

function clock() {
  let t = 0;
  const starts: number[] = [];
  return {
    starts,
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    mark: () => starts.push(t),
  };
}

const small: JevRequest = { state: "hi", questions: { q: { type: "noul", instructions: "Is this a greeting?" } } };

describe("pacedJev", () => {
  test("waits the gap plus jitter between starts", async () => {
    const c = clock();
    const inner = fakeJev(() => {
      c.mark();
      return 0.9;
    });
    const jev = pacedJev(inner, { gapMs: 20, jitterMs: 50, tokensPerSecond: 1e9, random: () => 0.5, now: c.now, sleep: c.sleep });
    for (let i = 0; i < 4; i++) await jev.systemOne(small);
    // First start: 25 ms of jitter; then 20 ms of gap and 25 of jitter each.
    expect(c.starts).toEqual([25, 70, 115, 160]);
    expect(jev.waitedMs).toBe(160);
  });

  test("keeps estimated input tokens under the budget", async () => {
    const c = clock();
    const inner = fakeJev(() => {
      c.mark();
      return 0.9;
    });
    const big: JevRequest = { state: "x".repeat(30_000), questions: small.questions };
    const tokens = estimateTokens(big.state, big.questions);
    const jev = pacedJev(inner, { gapMs: 0, jitterMs: 0, tokensPerSecond: 50_000, now: c.now, sleep: c.sleep });
    for (let i = 0; i < 3; i++) await jev.systemOne(big);
    const each = (tokens / 50_000) * 1000;
    expect(c.starts.map((s) => Math.round(s))).toEqual([0, Math.round(each), Math.round(2 * each)]);
  });

  test("concurrent callers queue behind each other", async () => {
    const c = clock();
    const jev = pacedJev(fakeJev(() => 0.9), { gapMs: 10, jitterMs: 0, tokensPerSecond: 1e9, now: c.now, sleep: async () => {} });
    await Promise.all([jev.systemOne(small), jev.systemOne(small), jev.systemOne(small)]);
    // Each reserved its own slot: waits of 0, 10 and 20 ms.
    expect(jev.waitedMs).toBe(30);
  });
});
