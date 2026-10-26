// The TypeSafe client's retries, against a local stand-in server (no network, no key needed).

import { afterAll, describe, expect, test } from "bun:test";
import { DEFAULT_JEV_MODEL, typesafeJev } from "../packages/question-kit/core/typesafe.ts";
import { standIn } from "./stand-in.ts";

let failures = 0;
const server = await standIn(async (req) => {
  if (failures > 0) {
    failures--;
    return Response.json({ detail: [{ msg: "The model is unavailable." }] }, { status: 503 });
  }
  const body = (await req.json()) as { questions: Record<string, unknown> };
  const answers = Object.fromEntries(Object.keys(body.questions).map((k) => [k, { type: "noul", noul: 0.9 }]));
  return Response.json({ model: "stand-in", answers, usage: { input_tokens: 10 } });
});
afterAll(() => server.stop());

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

describe("typesafeJev models", () => {
  const sent: string[] = [];
  let echo: Awaited<ReturnType<typeof standIn>>;
  const start = async () => {
    echo ??= await standIn(async (req) => {
      const body = (await req.json()) as { model: string; questions: Record<string, unknown> };
      sent.push(body.model);
      return Response.json({ model: body.model, answers: { q: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 10 } });
    });
    return echo.url.href;
  };
  afterAll(() => echo?.stop());

  test("with no model named, it asks DEFAULT_JEV_MODEL, never jev-latest", async () => {
    const saved = process.env.TYPESAFE_DEFAULT_MODEL;
    delete process.env.TYPESAFE_DEFAULT_MODEL;
    try {
      const client = typesafeJev({ apiKey: "test", baseURL: await start(), pace: false, onRetry: false });
      expect(client.model).toBe(DEFAULT_JEV_MODEL);
      const r = await client.systemOne(request);
      expect(sent.at(-1)).toBe(DEFAULT_JEV_MODEL);
      expect(r.model).toBe(DEFAULT_JEV_MODEL);
    } finally {
      if (saved !== undefined) process.env.TYPESAFE_DEFAULT_MODEL = saved;
    }
  });

  test("the client's model, then a request's own model, win", async () => {
    const client = typesafeJev({ apiKey: "test", baseURL: await start(), model: "jev-1.14.0", onRetry: false });
    expect(client.model).toBe("jev-1.14.0");
    await client.systemOne(request);
    expect(sent.at(-1)).toBe("jev-1.14.0");
    await client.systemOne({ ...request, model: "jev-latest" });
    expect(sent.at(-1)).toBe("jev-latest");
  });

  test("TYPESAFE_DEFAULT_MODEL is the default when set", async () => {
    const saved = process.env.TYPESAFE_DEFAULT_MODEL;
    process.env.TYPESAFE_DEFAULT_MODEL = "jev-1.14.0";
    try {
      expect(typesafeJev({ apiKey: "test", baseURL: await start(), onRetry: false }).model).toBe("jev-1.14.0");
    } finally {
      if (saved === undefined) delete process.env.TYPESAFE_DEFAULT_MODEL;
      else process.env.TYPESAFE_DEFAULT_MODEL = saved;
    }
  });
});
