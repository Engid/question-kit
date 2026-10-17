// The OpenRouter client against a local stand-in server (no network, no key needed).

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { checkAnswers, estimateOpenRouterTokens, limitsFor, OpenRouterError, openRouter, splitForLimits, wireIds } from "../packages/question-kit/experimental/openrouter.ts";
import { lint } from "../packages/question-kit/core/lint.ts";
import type { SystemOneRequest } from "../packages/question-kit/core/system-one.ts";

type Reply = (body: Record<string, unknown>) => Response;
let replies: Reply[] = [];
let seen: { path: string; auth: string | null; body: Record<string, unknown> }[] = [];

const answerAll: Reply = (body) => {
  const qs = body.questions as Record<string, { type: string; criteria?: unknown }>;
  const answers = Object.fromEntries(
    Object.entries(qs).map(([id, q]) => [
      id,
      q.type === "noul" ? { type: "noul", noul: 0.9 } : q.type === "choice" ? { type: "choice", choice: "a", confidence: 0.8, probabilities: { a: 0.8, b: 0.2 } } : { type: "score", score: 1.2, confidence: 0.7, probabilities: { "0": 0.1, "1": 0.6, "2": 0.3 } },
    ]),
  );
  return Response.json({ id: "gen-dec-1", model: `${body.model}-20260917`, provider: "Stand-in", answers, usage: { input_tokens: 12, output_tokens: 0, cost: 0.0000005 } });
};

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const body = (await req.json()) as Record<string, unknown>;
    seen.push({ path: new URL(req.url).pathname, auth: req.headers.get("authorization"), body });
    return (replies.shift() ?? answerAll)(body);
  },
});
afterAll(() => server.stop(true));
beforeEach(() => {
  replies = [];
  seen = [];
});

const baseURL = `${server.url.href}api`;
const fast = { backoffInitialMs: 5, backoffMaxMs: 20 };
const request: SystemOneRequest = {
  state: { ticket: "The checkout page is blank." },
  questions: {
    bug: { type: "noul", instructions: "Is `ticket` reporting a defect?" },
    team: { type: "choice", instructions: "Which team owns `ticket`?", criteria: { a: "Payments", b: "Accounts" } },
    urgency: { type: "score", instructions: "How urgent is `ticket`?", criteria: ["Can wait", "This week", "Now"] },
  },
  meta: { bug: "not sent" },
};

describe("openRouter", () => {
  test("posts to /api/alpha/decisions with the model, key and routing, and never meta", async () => {
    const client = openRouter({ apiKey: "k", model: "typesafe/jev-1.13", baseURL, provider: { zdr: true }, onRetry: false });
    const r = await client.systemOne(request);
    expect(seen[0]!.path).toBe("/api/alpha/decisions");
    expect(seen[0]!.auth).toBe("Bearer k");
    expect(seen[0]!.body).toEqual({ model: "typesafe/jev-1.13", state: request.state, questions: request.questions, provider: { zdr: true } });
    expect(r.answers.bug).toMatchObject({ noul: 0.9 });
    expect(r.model).toBe("typesafe/jev-1.13-20260917");
    expect((r as { usage?: { cost?: number } }).usage?.cost).toBe(0.0000005);
  });

  test("ids some hosts refuse are renamed on the wire and back in the answers", async () => {
    const client = openRouter({ apiKey: "k", model: "m", baseURL, onRetry: false });
    const r = await client.systemOne({
      state: "hi",
      questions: { "greet::check": { type: "noul", instructions: "Is this a greeting?" }, greet_check: { type: "noul", instructions: "Is it polite?" }, "size?": { type: "choice", instructions: "Which size?", criteria: { a: "Small", b: "Large" } } },
    });
    expect(Object.keys(seen[0]!.body.questions as object)).toEqual(["greet_check_2", "greet_check", "size_"]);
    expect(Object.keys(r.answers).sort()).toEqual(["greet::check", "greet_check", "size?"]);
  });

  test("a refusal names the question by its own id", async () => {
    replies = [() => Response.json({ error: { code: 502, message: 'OpenAI refused to answer question "tag_w1_choice"' } }, { status: 502 })];
    const client = openRouter({ apiKey: "k", model: "openai/gpt-6-luna-decisions", baseURL, onRetry: false });
    const err = await client.systemOne({ state: "hi", questions: { "tag_w1::choice": { type: "choice", instructions: "Which?", criteria: { a: "A", b: "B" } } } }).catch((e) => e);
    expect(err.message).toContain('question "tag_w1::choice"');
  });

  test("a request's own model wins over the client's", async () => {
    const client = openRouter({ apiKey: "k", model: "typesafe/jev-1.13", baseURL, onRetry: false });
    await client.systemOne({ ...request, model: "liquid/d1" });
    expect(seen[0]!.body.model).toBe("liquid/d1");
  });

  test("529 and 429 are retried, honoring Retry-After", async () => {
    replies = [() => new Response("busy", { status: 529 }), () => new Response("slow down", { status: 429, headers: { "retry-after": "0" } })];
    const told: string[] = [];
    const client = openRouter({ apiKey: "k", model: "m", baseURL, retry: fast, onRetry: (m) => told.push(m) });
    const r = await client.systemOne(request);
    expect(r.answers.team).toMatchObject({ choice: "a" });
    expect(told).toHaveLength(2);
    expect(told[0]).toMatch(/after 529/);
    expect(told[1]).toMatch(/^retrying in 0ms/);
  });

  test("it gives up after maxRetries, with OpenRouter's message", async () => {
    replies = [0, 1, 2].map(() => () => Response.json({ error: { code: 502, message: "Provider returned error" } }, { status: 502 }));
    const client = openRouter({ apiKey: "k", model: "m", baseURL, retry: { ...fast, maxRetries: 2 }, onRetry: false });
    await expect(client.systemOne(request)).rejects.toThrow(/502 for m: Provider returned error/);
  });

  test("a refused question (OpenRouter's 502) is not retried", async () => {
    replies = [() => Response.json({ error: { code: 502, message: 'OpenAI refused to answer question "team"' } }, { status: 502 })];
    const client = openRouter({ apiKey: "k", model: "openai/gpt-6-luna-decisions", baseURL, retry: fast, onRetry: false });
    const err = await client.systemOne(request).catch((e) => e);
    expect(err.kind).toBe("refused");
    expect(err.message).toMatch(/refused to answer question "team"/);
    expect(seen).toHaveLength(1);
  });

  test("a 400 is not retried and says why", async () => {
    replies = [() => Response.json({ error: { code: 400, message: "Invalid request", metadata: { field: "questions" } } }, { status: 400 })];
    const client = openRouter({ apiKey: "k", model: "m", baseURL, retry: fast, onRetry: false });
    const err = await client.systemOne(request).catch((e) => e);
    expect(err).toBeInstanceOf(OpenRouterError);
    expect(err.status).toBe(400);
    expect(err.message).toMatch(/Invalid request.*questions/);
    expect(seen).toHaveLength(1);
  });

  test("an HTML page with status 200 is an error, not an answer", async () => {
    replies = [() => new Response("<!DOCTYPE html><html>NEXT_HTTP_ERROR_FALLBACK;404</html>", { headers: { "content-type": "text/html" } })];
    const client = openRouter({ apiKey: "k", model: "m", baseURL, onRetry: false });
    await expect(client.systemOne(request)).rejects.toThrow(/text\/html instead of JSON/);
  });

  test("a Noul with one side of criteria is refused before sending", async () => {
    const client = openRouter({ apiKey: "k", model: "m", baseURL, onRetry: false });
    const oneSided: SystemOneRequest = { state: "hi", questions: { g: { type: "noul", instructions: "Is this a greeting?", criteria: { true: "It greets someone." } } } };
    const err = await client.systemOne(oneSided).catch((e) => e);
    expect(err).toBeInstanceOf(OpenRouterError);
    expect(err.kind).toBe("request");
    expect(seen).toHaveLength(0);
    // Both sides, or none, go through.
    await client.systemOne({ state: "hi", questions: { g: { type: "noul", instructions: "Is this a greeting?", criteria: { true: "It greets someone.", false: "It doesn't." } } } });
    expect(seen).toHaveLength(1);
  });

  test("strict: false sends it anyway (for probing a model)", async () => {
    const client = openRouter({ apiKey: "k", model: "m", baseURL, onRetry: false, strict: false });
    await client.systemOne({ state: "hi", questions: { g: { type: "noul", instructions: "Is this a greeting?", criteria: { true: "It greets someone." } } } });
    expect(seen).toHaveLength(1);
  });

  test("an answer without probabilities is an error naming the model", async () => {
    replies = [(body) => Response.json({ model: `${body.model}-x`, answers: { bug: { type: "noul", noul: 0.5 }, team: { type: "choice", choice: "a" }, urgency: { type: "score", score: 1, probabilities: { "0": 0.2, "1": 0.8 } } }, usage: { input_tokens: 1, output_tokens: 0 } })];
    const client = openRouter({ apiKey: "k", model: "tev", baseURL, onRetry: false });
    await expect(client.systemOne(request)).rejects.toThrow(/tev-x, question "team": no `probabilities`/);
  });

  test("a missing answer is an error", () => {
    expect(() => checkAnswers(request, { model: "x", answers: { bug: { noul: 0.1 } } })).toThrow(/no answer for question "team"/);
  });

  test("more questions than a model takes are sent as several requests and put back together", async () => {
    const questions = Object.fromEntries(Array.from({ length: 130 }, (_, i) => [`task::q${i}`, { type: "noul" as const, instructions: `Is \`ticket\` about thing ${i}?` }]));
    const client = openRouter({ apiKey: "k", model: "cloudflare/clef", baseURL, onRetry: false, provider: { order: ["cloudflare"], allow_fallbacks: false } });
    const r = await client.systemOne({ state: request.state, questions });
    expect(seen.map((s) => Object.keys(s.body.questions as object).length).sort((a, b) => a - b)).toEqual([2, 64, 64]);
    for (const s of seen) expect(s.body.state).toEqual(request.state);
    expect(Object.keys(r.answers).sort()).toEqual(Object.keys(questions).sort());
    const usage = (r as { usage?: { input_tokens: number; output_tokens: number; cost?: number } }).usage!;
    expect([usage.input_tokens, usage.output_tokens]).toEqual([36, 0]);
    expect(usage.cost).toBeCloseTo(0.0000015, 12);
  });

  test("limits: known per model and host; the smallest of the hosts routing allows; given ones win", () => {
    expect(limitsFor("cloudflare/clef")).toEqual({ maxQuestions: 64, maxTokens: 16_384 });
    expect(limitsFor("cloudflare/clef", { order: ["cloudflare"], allow_fallbacks: false })).toEqual({ maxQuestions: 64, maxTokens: 65_529 });
    expect(limitsFor("cloudflare/clef", { order: ["cloudflare"] }).maxTokens).toBe(16_384);
    expect(limitsFor("cloudflare/clef", { order: ["deepinfra/fp8"], allow_fallbacks: false }).maxTokens).toBe(65_536);
    expect(limitsFor("cloudflare/clef-flash", { order: ["cloudflare"], allow_fallbacks: false }).maxTokens).toBe(24_576);
    expect(limitsFor("openai/gpt-6-luna-decisions")).toEqual({ maxQuestions: Number.POSITIVE_INFINITY, maxTokens: Number.POSITIVE_INFINITY });
    expect(limitsFor("cloudflare/clef", undefined, { maxQuestions: 10, maxTokens: 1000 })).toEqual({ maxQuestions: 10, maxTokens: 1000 });
    expect(() => limitsFor("x", undefined, { maxQuestions: 0 })).toThrow(/at least 1/);
  });

  test("a request over the token limit is split by size, each part with the state", async () => {
    const big = "word ".repeat(400); // about 1,000 tokens a question at 2 characters a token
    const questions = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`q${i}`, { type: "noul" as const, instructions: `Is \`ticket\` about ${big}${i}?` }]));
    const parts = splitForLimits(request.state, questions, { maxQuestions: 64, maxTokens: 2_600 });
    expect(parts.map((p) => Object.keys(p))).toEqual([["q0", "q1"], ["q2", "q3"], ["q4", "q5"]]);
    for (const p of parts) expect(estimateOpenRouterTokens(request.state, p)).toBeLessThanOrEqual(2_600);
    const client = openRouter({ apiKey: "k", model: "typesafe/jev-1.13", baseURL, onRetry: false, maxTokens: 2_600 });
    const r = await client.systemOne({ state: request.state, questions });
    expect(seen.length).toBe(3);
    expect(Object.keys(r.answers).sort()).toEqual(Object.keys(questions));
  });

  test("a question that looks too big on its own is still sent, alone", async () => {
    const parts = splitForLimits(request.state, request.questions, { maxQuestions: 64, maxTokens: 300 });
    expect(parts.map((p) => Object.keys(p))).toEqual([["bug"], ["team"], ["urgency"]]);
  });

  test("a host that says the request is too big gets it again in halves", async () => {
    const tooBig = () => Response.json({ error: { message: 'HTTP 422: {"errors":[{"message":"AiError: Request requires 67060 tokens; the maximum is 65529"}]}' } }, { status: 422 });
    replies = [tooBig];
    const client = openRouter({ apiKey: "k", model: "typesafe/jev-1.13", baseURL, onRetry: false });
    const r = await client.systemOne(request);
    expect(Object.keys(seen[0]!.body.questions as object)).toEqual(["bug", "team", "urgency"]);
    expect(seen.slice(1).map((s) => Object.keys(s.body.questions as object).join(",")).sort()).toEqual(["bug,team", "urgency"]);
    expect(Object.keys(r.answers).sort()).toEqual(["bug", "team", "urgency"]);
    replies = [tooBig, tooBig, tooBig, tooBig, tooBig];
    const err = await openRouter({ apiKey: "k", model: "typesafe/jev-1.13", baseURL, onRetry: false }).systemOne({ ...request, questions: { bug: request.questions.bug! } }).catch((e) => e);
    expect((err as OpenRouterError).kind).toBe("too-big");
  });

  test("one failed part fails the whole request", async () => {
    replies = [answerAll, () => Response.json({ error: { message: "Bad input" } }, { status: 400 })];
    const client = openRouter({ apiKey: "k", model: "typesafe/jev-1.13", baseURL, onRetry: false, maxQuestions: 2 });
    await expect(client.systemOne(request)).rejects.toThrow(/400/);
  });

  test("ids longer than 100 characters are cut on the wire", () => {
    const long = "a".repeat(120);
    const { toWire } = wireIds([long, `${long}b`]);
    const wires = [...toWire.values()];
    expect(wires.every((w) => /^[A-Za-z0-9_.-]{1,100}$/.test(w))).toBe(true);
    expect(new Set(wires).size).toBe(2);
  });

  test("it needs a key and a model", () => {
    const saved = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    expect(() => openRouter({ model: "m" })).toThrow(/no API key/);
    if (saved !== undefined) process.env.OPENROUTER_API_KEY = saved;
    expect(() => openRouter({ apiKey: "k", model: "" })).toThrow(/model is required/);
  });
});

describe("lint: Noul criteria", () => {
  test("one side only is a warning (TypeSafe takes it; OpenRouter doesn't)", () => {
    const problems = lint("hi", { g: { type: "noul", instructions: "Is this a greeting?", criteria: { true: "It greets someone." } } });
    expect(problems).toContainEqual(expect.objectContaining({ question: "g", level: "warning", message: expect.stringMatching(/both sides/) }));
  });

  test("both sides, or none, are fine", () => {
    expect(lint("hi", { g: { type: "noul", instructions: "Is this a greeting?" } }).filter((p) => /both sides/.test(p.message))).toHaveLength(0);
    expect(lint("hi", { g: { type: "noul", instructions: "Is this a greeting?", criteria: { true: "Yes.", false: "No." } } }).filter((p) => /both sides/.test(p.message))).toHaveLength(0);
  });
});
