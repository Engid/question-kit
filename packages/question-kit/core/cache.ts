// An answer cache: wrap any client so each distinct request is sent once and its answers are kept
// on disk. Re-running tests, examples and measurements is then free, and a run can be repeated
// exactly.
//
//   import { cachedJev } from "question-kit/cache";
//   const client = cachedJev(typesafeJev(), ".cache/jev");                 // record: call on a miss, then save
//   const client = cachedJev(undefined, ".cache/jev", { mode: "replay" });  // replay: a miss throws, never calls
//
// A request's key is the SHA-256 of what Jev sees: its model, state and questions in the order
// they're sent (option order is part of the key, since it can change the answers). Question ids are
// not part of it: TypeSafe sends them to no model ("Question IDs are for your code",
// https://docs.typesafe.ai/primitives.md), so a request that differs only in its ids gets the cached
// answers back under its own ids. `meta` isn't part of the key, and isn't sent. Each answer is a
// JSON file at <dir>/<first two hex digits>/<key>.json, holding the request and the response.

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SystemOneClient, SystemOneRequest, SystemOneResponse } from "./system-one.ts";

export type CacheMode =
  /** Answer from the cache; on a miss, call the client and save its answer. */
  | "record"
  /** Answer from the cache only; a miss throws `CacheMissError`. For CI and repeatable runs. */
  | "replay";

export class CacheMissError extends Error {
  constructor(readonly key: string) {
    super(`no cached answer for request ${key.slice(0, 12)}… (record it first)`);
  }
}

export interface CachedJev extends SystemOneClient {
  /** Requests answered from the cache, and requests that weren't, since it was made. */
  readonly stats: { hits: number; misses: number };
}

/** One cached answer: the request as sent, and what came back. */
export interface CacheEntry {
  key: string;
  recordedAt: string;
  ms: number;
  request: SystemOneRequest;
  response: SystemOneResponse;
}

/** The cache key of a request: its model, state and question bodies in order; ids left out. */
export function cacheKey(request: SystemOneRequest): string {
  const body = JSON.stringify({ model: request.model ?? null, state: request.state, questions: Object.values(request.questions) });
  return createHash("sha256").update(body).digest("hex");
}

/**
 * A cached response with its answers under `request`'s ids. The entry may have been recorded for
 * the same questions under other ids; the questions are in the same order, so answers map by
 * position.
 */
export function relabel(entry: CacheEntry, request: SystemOneRequest): SystemOneResponse {
  const from = Object.keys(entry.request.questions);
  const to = Object.keys(request.questions);
  if (from.length === to.length && from.every((id, i) => id === to[i])) return entry.response;
  const answers: SystemOneResponse["answers"] = {};
  to.forEach((id, i) => {
    const a = entry.response.answers[from[i]!];
    if (a !== undefined) answers[id] = a;
  });
  return { ...entry.response, answers };
}

export function cachedJev(client: SystemOneClient | undefined, dir: string, opts: { mode?: CacheMode } = {}): CachedJev {
  const mode = opts.mode ?? "record";
  if (mode === "record" && !client) throw new Error('cachedJev: "record" mode needs a client to call on a miss');
  const stats = { hits: 0, misses: 0 };
  return {
    stats,
    async systemOne(request) {
      const key = cacheKey(request);
      const path = join(dir, key.slice(0, 2), `${key}.json`);
      try {
        const entry = JSON.parse(await readFile(path, "utf8")) as CacheEntry;
        stats.hits++;
        return relabel(entry, request);
      } catch (err) {
        if ((err as { code?: string }).code !== "ENOENT") throw err;
      }
      stats.misses++;
      if (mode === "replay" || !client) throw new CacheMissError(key);
      const t0 = performance.now();
      const response = await client.systemOne(request);
      const entry: CacheEntry = { key, recordedAt: new Date().toISOString(), ms: Math.round(performance.now() - t0), request, response };
      await mkdir(join(dir, key.slice(0, 2)), { recursive: true });
      await writeFile(path, JSON.stringify(entry));
      return response;
    },
  };
}

export interface RekeyReport {
  /** Entries found. */
  seen: number;
  /** Entries already at the path their key gives. */
  inPlace: number;
  /** Entries moved to the path their key gives. */
  moved: number;
  /** Entries left where they were because another entry already holds their key (the same request recorded twice). */
  collisions: number;
  /** Files that weren't cache entries. */
  bad: number;
}

/**
 * Move every entry in a cache folder to the path its key gives, after the key formula changed
 * (0.2.0 left question ids out of it). Each entry holds the request it was recorded for, so the
 * key is recomputed from that and nothing is lost: an entry already in place is left alone, and
 * when two entries share a key the first stays and the other is reported, not deleted. Pass
 * `keyOf` to re-key with another formula (the old one, say, to go back).
 */
export async function rekeyCache(dir: string, opts: { dryRun?: boolean; keyOf?: (request: SystemOneRequest) => string } = {}): Promise<RekeyReport> {
  const keyOf = opts.keyOf ?? cacheKey;
  const report: RekeyReport = { seen: 0, inPlace: 0, moved: 0, collisions: 0, bad: 0 };
  for (const sub of (await readdir(dir)).sort()) {
    if (!/^[0-9a-f]{2}$/.test(sub)) continue;
    for (const file of await readdir(join(dir, sub))) {
      if (!file.endsWith(".json")) continue;
      report.seen++;
      const path = join(dir, sub, file);
      let entry: CacheEntry;
      try {
        entry = JSON.parse(await readFile(path, "utf8")) as CacheEntry;
        if (!entry.request?.questions) throw new Error("not an entry");
      } catch {
        report.bad++;
        continue;
      }
      const key = keyOf(entry.request);
      if (file === `${key}.json`) {
        report.inPlace++;
        continue;
      }
      const to = join(dir, key.slice(0, 2), `${key}.json`);
      if (await stat(to).then(() => true, () => false)) {
        report.collisions++;
        continue;
      }
      if (!opts.dryRun) {
        await mkdir(join(dir, key.slice(0, 2)), { recursive: true });
        // The entry with its new key, written in place, then moved: a crash leaves one of the two.
        await writeFile(path, JSON.stringify({ ...entry, key }));
        await rename(path, to);
      }
      report.moved++;
    }
  }
  return report;
}
