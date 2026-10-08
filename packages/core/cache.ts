// An answer cache: wrap any client so each distinct request is sent once and its answers are kept
// on disk. Re-running tests, examples and measurements is then free, and a run can be repeated
// exactly.
//
//   import { cachedJev } from "question-kit/cache";
//   const jev = cachedJev(typesafeJev(), ".cache/jev");                 // record: call on a miss, then save
//   const jev = cachedJev(undefined, ".cache/jev", { mode: "replay" });  // replay: a miss throws, never calls
//
// A request's key is the SHA-256 of its model, state and questions in the order they're sent
// (option order is part of the key, since it can change the answers). `meta` isn't part of the key,
// and isn't sent. Each answer is a JSON file at <dir>/<first two hex digits>/<key>.json, holding the
// request and the response.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { JevClient, JevRequest, JevResponse } from "./jev.ts";

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

export interface CachedJev extends JevClient {
  /** Requests answered from the cache, and requests that weren't, since it was made. */
  readonly stats: { hits: number; misses: number };
}

interface CacheEntry {
  key: string;
  recordedAt: string;
  ms: number;
  request: JevRequest;
  response: JevResponse;
}

/** The cache key of a request. */
export function cacheKey(request: JevRequest): string {
  const body = JSON.stringify({ model: request.model ?? null, state: request.state, questions: request.questions });
  return createHash("sha256").update(body).digest("hex");
}

export function cachedJev(client: JevClient | undefined, dir: string, opts: { mode?: CacheMode } = {}): CachedJev {
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
        return entry.response;
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
