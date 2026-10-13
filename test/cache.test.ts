import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeJev, type SystemOneRequest } from "question-kit";
import { CacheMissError, cacheKey, cachedJev, rekeyCache } from "question-kit/cache";
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const request: SystemOneRequest = {
  state: "a large oat latte",
  questions: { milk: { type: "choice", instructions: "Which milk?", criteria: { oat: null, whole: null } } },
};

describe("cachedJev", () => {
  test("record: the first request calls the client, the same request again doesn't", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qk-cache-"));
    const inner = fakeJev(() => "oat");
    const client = cachedJev(inner, dir);
    const a = await client.systemOne(request);
    const b = await client.systemOne({ ...request, meta: { milk: "not part of the key" } });
    expect(b).toEqual(a);
    expect(inner.requests.length).toBe(1);
    expect(client.stats).toEqual({ hits: 1, misses: 1 });
    // Another client on the same folder replays it without calling anything.
    expect(await cachedJev(undefined, dir, { mode: "replay" }).systemOne(request)).toEqual(a);
  });

  test("replay: a request it hasn't seen throws CacheMissError", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qk-cache-"));
    await expect(cachedJev(undefined, dir, { mode: "replay" }).systemOne(request)).rejects.toBeInstanceOf(CacheMissError);
  });

  test("a different option order is a different request", () => {
    const swapped: SystemOneRequest = { ...request, questions: { milk: { type: "choice", instructions: "Which milk?", criteria: { whole: null, oat: null } } } };
    expect(cacheKey(swapped)).not.toBe(cacheKey(request));
  });

  test("question ids aren't part of the key: the same questions under other ids replay, relabeled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qk-cache-"));
    const a = await cachedJev(fakeJev(() => "oat"), dir).systemOne(request);
    const renamed: SystemOneRequest = { ...request, questions: { "milk::choice": request.questions.milk! } };
    expect(cacheKey(renamed)).toBe(cacheKey(request));
    const b = await cachedJev(undefined, dir, { mode: "replay" }).systemOne(renamed);
    expect(Object.keys(b.answers)).toEqual(["milk::choice"]);
    expect(b.answers["milk::choice"]).toEqual(a.answers.milk!);
  });

  test("a different question order is a different request", () => {
    const two: SystemOneRequest = { ...request, questions: { ...request.questions, size: { type: "choice", instructions: "Which size?", criteria: { small: null, large: null } } } };
    const swapped: SystemOneRequest = { ...request, questions: { size: two.questions.size!, milk: two.questions.milk! } };
    expect(cacheKey(swapped)).not.toBe(cacheKey(two));
  });

  test("the key is SHA-256 of the model, state and question bodies in order", () => {
    const body = JSON.stringify({ model: null, state: request.state, questions: [request.questions.milk] });
    expect(cacheKey(request)).toBe(new Bun.CryptoHasher("sha256").update(body).digest("hex"));
  });

  test("rekeyCache moves entries written under the old key (ids included) to the new one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qk-cache-"));
    const oldKey = (r: SystemOneRequest) => createHash("sha256").update(JSON.stringify({ model: r.model ?? null, state: r.state, questions: r.questions })).digest("hex");
    const response = await cachedJev(fakeJev(() => "oat"), mkdtempSync(join(tmpdir(), "qk-"))).systemOne(request);
    const old = oldKey(request);
    mkdirSync(join(dir, old.slice(0, 2)), { recursive: true });
    writeFileSync(join(dir, old.slice(0, 2), `${old}.json`), JSON.stringify({ key: old, recordedAt: "", ms: 1, request, response }));
    expect(await rekeyCache(dir, { dryRun: true })).toEqual({ seen: 1, inPlace: 0, moved: 1, collisions: 0, bad: 0 });
    await expect(cachedJev(undefined, dir, { mode: "replay" }).systemOne(request)).rejects.toBeInstanceOf(CacheMissError);
    expect(await rekeyCache(dir)).toEqual({ seen: 1, inPlace: 0, moved: 1, collisions: 0, bad: 0 });
    expect(await cachedJev(undefined, dir, { mode: "replay" }).systemOne(request)).toEqual(response);
    expect(await rekeyCache(dir)).toEqual({ seen: 1, inPlace: 1, moved: 0, collisions: 0, bad: 0 });
    // Back to the old formula, and the old path.
    expect((await rekeyCache(dir, { keyOf: oldKey })).moved).toBe(1);
    expect(JSON.parse(await Bun.file(join(dir, old.slice(0, 2), `${old}.json`)).text()).key).toBe(old);
  });
});
