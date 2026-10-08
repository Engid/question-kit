// A client for TypeSafe's API, through their SDK (`@typesafe-ai/sdk`, installed separately).
//
//   import { typesafeJev } from "question-kit/typesafe";
//   const jev = typesafeJev();   // reads TYPESAFE_API_KEY
//
// The rest of question-kit only needs something with a `systemOne(request)` method, so this file is
// the only one that touches the SDK.

import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { JevClient, JevRequest, JevResponse } from "./jev.ts";

export interface TypeSafeOptions {
  /** Default: the TYPESAFE_API_KEY environment variable. */
  apiKey?: string;
  model?: string;
  /** Per-attempt timeout in ms. Default 60 000 (the SDK's own default is 10 000; big requests can take longer). */
  timeoutMs?: number;
}

export function typesafeJev(opts: TypeSafeOptions = {}): JevClient {
  const apiKey = opts.apiKey ?? process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new Error("typesafeJev: no API key (pass apiKey or set TYPESAFE_API_KEY)");
  const client = new TypeSafeClient({ apiKey, timeout: opts.timeoutMs ?? 60_000, ...(opts.model ? { defaultModel: opts.model } : {}) });
  return {
    async systemOne(request: JevRequest): Promise<JevResponse> {
      // Only what the API takes: never `meta`. Our wire types mirror the SDK's; the cast bridges its
      // stricter generic question types.
      const body = { state: request.state, questions: request.questions, ...(request.model ? { model: request.model } : {}) };
      return (await client.systemOne(body as Parameters<TypeSafeClient["systemOne"]>[0])) as unknown as JevResponse;
    },
  };
}
