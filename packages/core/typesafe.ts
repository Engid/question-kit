// A client for TypeSafe's API, through their SDK (`@typesafe-ai/sdk`, installed separately).
//
//   import { typesafeJev } from "question-kit/typesafe";
//   const jev = typesafeJev();   // reads TYPESAFE_API_KEY
//
// The rest of question-kit only needs something with a `systemOne(request)` method, so this file is
// the only one that touches the SDK.

import { type Logger, type RetryPolicy, TypeSafeClient } from "@typesafe-ai/sdk";
import type { JevClient, JevRequest, JevResponse } from "./jev.ts";
import { type PaceOptions, pacedJev } from "./pace.ts";

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

export function typesafeJev(opts: TypeSafeOptions = {}): JevClient {
  const apiKey = opts.apiKey ?? process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new Error("typesafeJev: no API key (pass apiKey or set TYPESAFE_API_KEY)");
  const client = new TypeSafeClient({
    apiKey,
    timeout: opts.timeoutMs ?? 60_000,
    retry: { ...DEFAULT_RETRY, ...opts.retry },
    ...(opts.model ? { defaultModel: opts.model } : {}),
    ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    ...retryLogging(opts.onRetry),
  });
  const direct: JevClient = {
    async systemOne(request: JevRequest): Promise<JevResponse> {
      // Only what the API takes: never `meta`. Our wire types mirror the SDK's; the cast bridges its
      // stricter generic question types.
      const body = { state: request.state, questions: request.questions, ...(request.model ? { model: request.model } : {}) };
      return (await client.systemOne(body as Parameters<TypeSafeClient["systemOne"]>[0])) as unknown as JevResponse;
    },
  };
  return opts.pace === false ? direct : pacedJev(direct, opts.pace ?? {});
}

/**
 * The SDK reports retries at its "info" log level, which is off by default ("warn"). To hear about
 * retries without every request summary, log at "info" through a logger that passes on only the
 * retry lines (and warnings and errors as usual). Without `onRetry`, an explicit TYPESAFE_LOG_LEVEL
 * is left alone.
 */
function retryLogging(onRetry: TypeSafeOptions["onRetry"]): { logLevel?: "info"; logger?: Logger } {
  if (onRetry === false || (onRetry === undefined && process.env.TYPESAFE_LOG_LEVEL)) return {};
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
