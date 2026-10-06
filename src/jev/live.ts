import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { JevClient, JevRequest, JevResponse } from "./types.ts";

export interface LiveOptions {
  apiKey?: string;
  model?: string;
  /** Per-attempt timeout in ms. The SDK default is 10 000; big head-selection requests can take longer. */
  timeoutMs?: number;
}

/** The real API, through `@typesafe-ai/sdk`. Reads TYPESAFE_API_KEY when no key is passed. */
export class LiveJevClient implements JevClient {
  readonly name = "live";
  private readonly client: TypeSafeClient;

  constructor(opts: LiveOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.TYPESAFE_API_KEY;
    if (!apiKey) throw new Error("TYPESAFE_API_KEY is not set");
    this.client = new TypeSafeClient({
      apiKey,
      timeout: opts.timeoutMs ?? 60_000,
      ...(opts.model ? { defaultModel: opts.model } : {}),
    });
  }

  async systemOne(request: JevRequest): Promise<JevResponse> {
    // Send only what the API takes (never `meta`). Our wire types mirror the SDK's; the cast bridges
    // its stricter generic question types.
    const body = { state: request.state, questions: request.questions, ...(request.model ? { model: request.model } : {}) };
    const res = await this.client.systemOne(body as Parameters<TypeSafeClient["systemOne"]>[0]);
    return res as unknown as JevResponse;
  }
}
