import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeJev, type JevRequest } from "question-kit";
import { CacheMissError, cacheKey, cachedJev } from "question-kit/cache";

const request: JevRequest = {
  state: "a large oat latte",
  questions: { milk: { type: "choice", instructions: "Which milk?", criteria: { oat: null, whole: null } } },
};

describe("cachedJev", () => {
  test("record: the first request calls the client, the same request again doesn't", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qk-cache-"));
    const inner = fakeJev(() => "oat");
    const jev = cachedJev(inner, dir);
    const a = await jev.systemOne(request);
    const b = await jev.systemOne({ ...request, meta: { milk: "not part of the key" } });
    expect(b).toEqual(a);
    expect(inner.requests.length).toBe(1);
    expect(jev.stats).toEqual({ hits: 1, misses: 1 });
    // Another client on the same folder replays it without calling anything.
    expect(await cachedJev(undefined, dir, { mode: "replay" }).systemOne(request)).toEqual(a);
  });

  test("replay: a request it hasn't seen throws CacheMissError", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qk-cache-"));
    await expect(cachedJev(undefined, dir, { mode: "replay" }).systemOne(request)).rejects.toBeInstanceOf(CacheMissError);
  });

  test("a different option order is a different request", () => {
    const swapped: JevRequest = { ...request, questions: { milk: { type: "choice", instructions: "Which milk?", criteria: { whole: null, oat: null } } } };
    expect(cacheKey(swapped)).not.toBe(cacheKey(request));
  });

  test("the key is the one existing caches were written with", () => {
    // SHA-256 of {model, state, questions}: the research harness's recording client used the same
    // formula, so answers it cached replay here.
    const body = JSON.stringify({ model: null, state: request.state, questions: request.questions });
    expect(cacheKey(request)).toBe(new Bun.CryptoHasher("sha256").update(body).digest("hex"));
  });
});
