import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeJev, type SystemOneRequest } from "question-kit";
import { CacheMissError, cacheKey, cachedJev, rekeyCache, UNNAMED_MODEL } from "question-kit/cache";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
    expect(cacheKey(request)).toBe(createHash("sha256").update(body).digest("hex"));
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
    expect(JSON.parse(readFileSync(join(dir, old.slice(0, 2), `${old}.json`), "utf8")).key).toBe(old);
  });
});

describe("cachedJev and models", () => {
  const withModel = (model: string) => ({ ...fakeJev(() => "oat"), model });

  test("jev-1.13.0, the default, is keyed with no model, as entries recorded before 0.4 are", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qk-cache-"));
    await cachedJev(withModel(UNNAMED_MODEL), dir).systemOne(request);
    const key = cacheKey(request);
    const entry = JSON.parse(readFileSync(join(dir, key.slice(0, 2), `${key}.json`), "utf8"));
    expect(entry.request.model).toBeUndefined();
    // An entry with no model replays without a client, as before.
    expect(await cachedJev(undefined, dir, { mode: "replay" }).systemOne(request)).toBeDefined();
  });

  test("another model gets its own entries, and the entry's request names it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qk-cache-"));
    await cachedJev(withModel(UNNAMED_MODEL), dir).systemOne(request);
    const newer = cachedJev(withModel("jev-1.14.0"), dir);
    await newer.systemOne(request);
    expect(newer.stats).toEqual({ hits: 0, misses: 1 });
    const key = cacheKey({ ...request, model: "jev-1.14.0" });
    const entry = JSON.parse(readFileSync(join(dir, key.slice(0, 2), `${key}.json`), "utf8"));
    expect(entry.request.model).toBe("jev-1.14.0");
    expect(cacheKey(entry.request)).toBe(entry.key);
    // Replaying 1.14 without a client needs the model named.
    expect(await cachedJev(undefined, dir, { mode: "replay", model: "jev-1.14.0" }).systemOne(request)).toBeDefined();
  });

  test("a request's own model wins over the client's", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qk-cache-"));
    const named = { ...request, model: "jev-latest" };
    await cachedJev(withModel("jev-1.14.0"), dir).systemOne(named);
    expect(await cachedJev(undefined, dir, { mode: "replay" }).systemOne(named)).toBeDefined();
  });

  test("naming jev-1.13.0 on the request is the same entry as getting it by default", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qk-cache-"));
    await cachedJev(withModel(UNNAMED_MODEL), dir).systemOne(request);
    const replay = cachedJev(undefined, dir, { mode: "replay" });
    expect(await replay.systemOne({ ...request, model: UNNAMED_MODEL })).toBeDefined();
  });

  test("the client is asked the model the request names, whatever the client's default", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qk-cache-"));
    const asked: (string | undefined)[] = [];
    const inner = { model: "jev-1.14.0", systemOne: async (r: SystemOneRequest) => (asked.push(r.model), fakeJev(() => "oat").systemOne(r)) };
    const client = cachedJev(inner, dir);
    await client.systemOne({ ...request, model: UNNAMED_MODEL });
    await client.systemOne(request);
    expect(asked).toEqual([UNNAMED_MODEL, "jev-1.14.0"]);
    expect(client.stats).toEqual({ hits: 0, misses: 2 });
  });

  test("the cache passes its client's model on", () => {
    expect(cachedJev(withModel("jev-1.14.0"), mkdtempSync(join(tmpdir(), "qk-cache-"))).model).toBe("jev-1.14.0");
  });
});
