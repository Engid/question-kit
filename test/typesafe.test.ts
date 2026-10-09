// The TypeSafe client's retries, against a local stand-in server (no network, no key needed).

import { afterAll, describe, expect, test } from "bun:test";
import { typesafeJev } from "../packages/question-kit/core/typesafe.ts";

let failures = 0;
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    if (failures > 0) {
      failures--;
      return Response.json({ detail: [{ msg: "The model is unavailable." }] }, { status: 503 });
    }
    const body = (await req.json()) as { questions: Record<string, unknown> };
    const answers = Object.fromEntries(Object.keys(body.questions).map((k) => [k, { type: "noul", noul: 0.9 }]));
    return Response.json({ model: "stand-in", answers, usage: { input_tokens: 10 } });
  },
});
afterAll(() => server.stop(true));

const request = { state: "hello", questions: { q: { type: "noul" as const, instructions: "Is this a greeting?" } } };
const fast = { backoffInitialMs: 5, backoffMaxMs: 20 };

describe("typesafeJev retries", () => {
  test("a 503 is retried with backoff, and each retry is reported", async () => {
    failures = 2;
    const told: string[] = [];
    const client = typesafeJev({ apiKey: "test", baseURL: server.url.href, retry: fast, onRetry: (m) => told.push(m) });
    const r = await client.systemOne(request);
    expect(r.answers.q).toMatchObject({ noul: 0.9 });
    expect(told.length).toBe(2);
    expect(told[0]).toMatch(/^retrying in \d+ms \(retry 1\/5\) after 503$/);
  });

  test("it gives up after maxRetries", async () => {
    failures = 3;
    const client = typesafeJev({ apiKey: "test", baseURL: server.url.href, retry: { ...fast, maxRetries: 2 }, onRetry: false });
    await expect(client.systemOne(request)).rejects.toThrow(/503/);
  });
});
