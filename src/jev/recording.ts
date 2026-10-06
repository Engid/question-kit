import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { JevClient, JevRequest, JevResponse } from "./types.ts";

export type RecordingMode =
  /** Answer from the cache only; a miss throws. Safe in CI and for repeatable evals. */
  | "replay"
  /** Answer from the cache, and call the inner client (and save) on a miss. */
  | "record";

export class CacheMissError extends Error {
  constructor(readonly key: string) {
    super(`no cached Jev response for request ${key.slice(0, 12)}… (run with --client record to fetch it)`);
  }
}

interface CacheEntry {
  key: string;
  recordedAt: string;
  ms: number;
  request: JevRequest;
  response: JevResponse;
}

/**
 * Caches responses by a hash of the request (model, state and questions, in their sent order —
 * option order is part of the key because it can change Jev's answer).
 */
export class RecordingJevClient implements JevClient {
  readonly name: string;
  hits = 0;
  misses = 0;

  constructor(
    private readonly inner: JevClient | undefined,
    private readonly dir: string,
    private readonly mode: RecordingMode,
  ) {
    this.name = `${mode}(${inner?.name ?? "none"})`;
    if (mode === "record" && !inner) throw new Error("record mode needs an inner client");
  }

  static key(request: JevRequest): string {
    const body = JSON.stringify({ model: request.model ?? null, state: request.state, questions: request.questions });
    return new Bun.CryptoHasher("sha256").update(body).digest("hex");
  }

  async systemOne(request: JevRequest): Promise<JevResponse> {
    const key = RecordingJevClient.key(request);
    const path = join(this.dir, key.slice(0, 2), `${key}.json`);
    try {
      const entry = JSON.parse(await readFile(path, "utf8")) as CacheEntry;
      this.hits++;
      return entry.response;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    this.misses++;
    if (this.mode === "replay" || !this.inner) throw new CacheMissError(key);
    const t0 = performance.now();
    const response = await this.inner.systemOne(request);
    const entry: CacheEntry = {
      key,
      recordedAt: new Date().toISOString(),
      ms: Math.round(performance.now() - t0),
      request,
      response,
    };
    await mkdir(join(this.dir, key.slice(0, 2)), { recursive: true });
    await writeFile(path, JSON.stringify(entry));
    return response;
  }
}
