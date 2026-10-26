// A client for TypeSafe's API, through their SDK (`@typesafe-ai/sdk`, installed separately).
//
//   import { typesafeJev } from "question-kit/typesafe";
//   const client = typesafeJev();                          // reads TYPESAFE_API_KEY; asks jev-1.13.0
//   const newer = typesafeJev({ model: "jev-1.14.0" });
//
// The rest of question-kit only needs something with a `systemOne(request)` method, so this file is
// the only one that touches the SDK.

import { type Fetch, type Logger, type RetryPolicy, TypeSafeClient } from "@typesafe-ai/sdk";
import type { SystemOneClient, SystemOneRequest, SystemOneResponse } from "./system-one.ts";
import { type PaceOptions, pacedJev } from "./pace.ts";

/**
 * The Jev version asked when neither the request nor `typesafeJev({ model })` names one (nor the
 * TYPESAFE_DEFAULT_MODEL environment variable). Pinned per release, so an upgrade of TypeSafe's
 * `jev-latest` doesn't change answers under you; pass `"jev-latest"` to follow it instead.
 */
export const DEFAULT_JEV_MODEL = "jev-1.13.0";

/**
 * Retries: HTTP 408, 429 and 5xx (such as 503 "model unavailable"), timeouts and dropped
 * connections, with exponential backoff and jitter. The SDK does the retrying; this only changes its
 * defaults. Here: 5 retries, waiting about 1, 2, 4, 8 and 16 seconds (each up to a quarter less, at
 * random), so about half a minute before giving up; a server's `Retry-After` up to a minute wins.
 * The SDK's own default is 2 retries over about 1.5 seconds.
 */
export const DEFAULT_RETRY: Partial<RetryPolicy> = { maxRetries: 5, backoffInitialMs: 1_000, backoffMaxMs: 16_000 };

export interface TypeSafeOptions {
  /** Default: the TYPESAFE_API_KEY environment variable. */
  apiKey?: string;
  /**
   * The Jev version to ask, such as `"jev-1.14.0"`; a request's own `model` wins. Default: the
   * TYPESAFE_DEFAULT_MODEL environment variable, then {@link DEFAULT_JEV_MODEL}.
   */
  model?: string;
  /** Per-attempt timeout in ms. Default 60 000 (the SDK's own default is 10 000; big requests can take longer). */
  timeoutMs?: number;
  /**
   * Retry settings, merged over {@link DEFAULT_RETRY}. In a live conversation you may want fewer
   * (`{ maxRetries: 2 }`) and a fallback; for batch runs, more. `{ maxRetries: 0 }` turns retries off.
   */
  retry?: Partial<RetryPolicy>;
  /** Told about each retry before it waits ("retrying in 1890ms (retry 1/5) after 503"). Default: a line on stderr. `false`: quiet. */
  onRetry?: ((message: string) => void) | false;
  /** API root. Default: the SDK's (`TYPESAFE_BASE_URL`, then TypeSafe's). */
  baseURL?: string;
  /**
   * Space requests out: a short random wait between them (20 ms plus up to 50 ms) and at most
   * 50,000 input tokens a second, half of TypeSafe's current limit. `false` sends as fast as it can.
   */
  pace?: PaceOptions | false;
}

/** An environment variable, where there is an environment (not in a browser). */
const env = (name: string): string | undefined => (typeof process !== "undefined" ? process.env?.[name] : undefined);

export function typesafeJev(opts: TypeSafeOptions = {}): SystemOneClient {
  const apiKey = opts.apiKey ?? env("TYPESAFE_API_KEY");
  if (!apiKey) throw new Error("typesafeJev: no API key (pass apiKey or set TYPESAFE_API_KEY)");
  const model = opts.model ?? env("TYPESAFE_DEFAULT_MODEL") ?? DEFAULT_JEV_MODEL;
  const client = new TypeSafeClient({
    apiKey,
    timeout: opts.timeoutMs ?? 60_000,
    retry: { ...DEFAULT_RETRY, ...opts.retry },
    defaultModel: model,
    ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    ...(isBun ? { fetch: bunFetch } : {}),
    ...retryLogging(opts.onRetry),
  });
  const direct: SystemOneClient = {
    model,
    async systemOne(request: SystemOneRequest): Promise<SystemOneResponse> {
      // Only what the API takes: never `meta`. Always a model, so the answer never depends on what
      // `jev-latest` points to today. Our wire types mirror the SDK's; the cast bridges its stricter
      // generic question types.
      const body = { state: request.state, questions: request.questions, model: request.model ?? model };
      return (await client.systemOne(body as Parameters<TypeSafeClient["systemOne"]>[0])) as unknown as SystemOneResponse;
    },
  };
  return opts.pace === false ? direct : pacedJev(direct, opts.pace ?? {});
}

/**
 * Bun workaround (temporary). SDK 0.7.0 takes a reader on each response's body to buffer it, then
 * reads the body again; under Bun, taking a reader marks the body used, so every request fails with
 * "Body already used" (Node follows the Streams spec here and works). Hiding `body` from the SDK
 * skips its buffering; it then reads the body with `text()` as usual. The cost: the per-attempt
 * timeout no longer covers reading the body. Remove once either side is fixed; test/bun-shim.test.ts
 * fails when it is.
 *   https://github.com/typesafe-ai/typesafe-sdk-js/issues/20
 *   https://github.com/oven-sh/bun/issues/45306
 */
const isBun = typeof process !== "undefined" && Boolean(process.versions?.bun);

const bunFetch: Fetch = async (input, init) => {
  const response = await fetch(input, init);
  Object.defineProperty(response, "body", { value: null, configurable: true });
  return response;
};

/**
 * The SDK reports retries at its "info" log level, which is off by default ("warn"). To hear about
 * retries without every request summary, log at "info" through a logger that passes on only the
 * retry lines (and warnings and errors as usual). Without `onRetry`, an explicit TYPESAFE_LOG_LEVEL
 * is left alone.
 */
function retryLogging(onRetry: TypeSafeOptions["onRetry"]): { logLevel?: "info"; logger?: Logger } {
  if (onRetry === false || (onRetry === undefined && env("TYPESAFE_LOG_LEVEL"))) return {};
  const tell = onRetry ?? ((m: string) => console.error(`typesafe: ${m}`));
  return {
    logLevel: "info",
    logger: {
      debug: () => {},
      info: (message: string) => {
        const at = message.indexOf("retrying in ");
        if (at >= 0) tell(message.slice(at));
      },
      warn: (message: string, ...args: unknown[]) => console.warn(message, ...args),
      error: (message: string, ...args: unknown[]) => console.error(message, ...args),
    },
  };
}
