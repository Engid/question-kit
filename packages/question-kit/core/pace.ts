// Pacing requests: a short random wait between them, and a cap on input tokens per second.
//
// For batch runs (evals, backfills) that would otherwise send as fast as the network allows.
// TypeSafe's limits for jev-1.13 are 80 requests and 100,000 tokens per second, "adjusting
// dynamically"; over either, the API answers 429 (https://docs.typesafe.ai/models). Pacing keeps a
// run well under them, so it doesn't lean on retries.

import { estimateTokens, type SystemOneClient, type SystemOneRequest, type SystemOneResponse } from "./system-one.ts";

export interface PaceOptions {
  /** Least time between the starts of two requests, in ms. Default 20. */
  gapMs?: number;
  /** A random extra wait of up to this many ms before each request. Default 50. */
  jitterMs?: number;
  /** Most estimated input tokens per second. Default 50,000 (half of TypeSafe's current limit). */
  tokensPerSecond?: number;
  /** For tests. */
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export const DEFAULT_PACE: Required<Pick<PaceOptions, "gapMs" | "jitterMs" | "tokensPerSecond">> = { gapMs: 20, jitterMs: 50, tokensPerSecond: 50_000 };

/**
 * Wrap a client so its requests are spaced out. Requests still run concurrently; only their
 * starts are spread. Each start waits for the gap since the last start, plus a random jitter, and
 * for enough of the token budget: a request of T tokens uses T / tokensPerSecond seconds of it.
 */
export function pacedJev(client: SystemOneClient, opts: PaceOptions = {}): SystemOneClient & { waitedMs: number } {
  const { gapMs, jitterMs, tokensPerSecond } = { ...DEFAULT_PACE, ...opts };
  const random = opts.random ?? Math.random;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => Date.now());
  let lastStart = -Infinity;
  let budgetFreeAt = -Infinity;
  const paced = {
    waitedMs: 0,
    async systemOne(request: SystemOneRequest): Promise<SystemOneResponse> {
      // Reserve this request's slot before waiting, so concurrent callers queue behind it.
      const t = now();
      const tokens = estimateTokens(request.state, request.questions);
      const start = Math.max(t, lastStart + gapMs, budgetFreeAt) + random() * jitterMs;
      lastStart = start;
      budgetFreeAt = Math.max(start, budgetFreeAt) + (tokens / tokensPerSecond) * 1000;
      const wait = start - t;
      if (wait > 0) {
        paced.waitedMs += wait;
        await sleep(wait);
      }
      return client.systemOne(request);
    },
  };
  return paced;
}
