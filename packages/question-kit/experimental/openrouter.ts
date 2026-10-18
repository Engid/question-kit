// A client for OpenRouter's Decisions API, which serves Jev and other System One models behind one
// request shape (TypeSafe's): `state` plus `questions` keyed by id.
//
//   import { openRouter } from "question-kit/experimental/openrouter";
//   const client = openRouter({ model: "typesafe/jev-1.13" });   // reads OPENROUTER_API_KEY
//
// Experimental (see docs/experimental.md): it can change in any release, including patches.
// OpenRouter labels the endpoint alpha (POST /api/alpha/decisions), and question-kit is tuned on
// Jev. Other models get the same requests, wording and thresholds; nothing is adjusted
// for them. Where a model or OpenRouter can't take a request as it is, this client says so with an
// error instead of working around it:
// - a Noul whose criteria give only one side is refused before sending (OpenRouter answers 400);
// - a Choice or Score answer without `probabilities`, or a missing answer, is an error naming the
//   model, since the readings need the probabilities.
// Some hosts only take question ids of up to 100 letters, digits, `_`, `.` and `-`; any other id
// (such as runAll's `<task>::<question>`) is renamed on the way out and back on the way in. Ids
// aren't part of what a model is asked, so this changes nothing about the answers.
// Some hosts take at most so many questions, or tokens, per request (Clef's: 64 questions, and 16k
// to 64k tokens depending on the host). A request over a known limit is sent as several, each with
// the whole state and some of the questions, and the answers are put back together; the state is
// billed once per part. A host that says a request is too big ("requires N tokens; the maximum is
// M") gets it again in halves.
//
// Pin a dated model (`liquid/d1-20260930`) for repeatable runs; the response's `model` says which
// one answered. With an answer cache, give each model its own folder or set `request.model`, so
// answers from different models never share a key.

import type { Answer, Question, SystemOneClient, SystemOneRequest, SystemOneResponse } from "../core/system-one.ts";
import { type PaceOptions, pacedJev } from "../core/pace.ts";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api";
const DECISIONS_PATH = "/alpha/decisions";

export interface OpenRouterRetry {
  /** Retries after the first try. Default 5. */
  maxRetries?: number;
  /** The first wait, doubled each retry. Default 1 000 ms. */
  backoffInitialMs?: number;
  /** The longest wait. Default 16 000 ms. A server's `Retry-After` up to a minute wins. */
  backoffMaxMs?: number;
}

export interface OpenRouterOptions {
  /** A System One model on OpenRouter, such as `typesafe/jev-1.13`. A request's own `model` wins. */
  model: string;
  /** Default: the OPENROUTER_API_KEY environment variable. */
  apiKey?: string;
  /**
   * OpenRouter's routing preferences, sent as `provider` unchanged: `{ zdr: true }`,
   * `{ data_collection: "deny" }`, `{ order: [...], allow_fallbacks: false }` and so on.
   */
  provider?: Record<string, unknown>;
  /** API root. Default: OPENROUTER_BASE_URL, then `https://openrouter.ai/api`; the client adds `/alpha/decisions`. */
  baseURL?: string;
  /** Per-attempt timeout in ms. Default 60 000. */
  timeoutMs?: number;
  /** Merged over the defaults: 5 retries, about 1, 2, 4, 8 and 16 seconds apart. `{ maxRetries: 0 }` turns them off. */
  retry?: OpenRouterRetry;
  /** Told about each retry before it waits. Default: a line on stderr. `false`: quiet. */
  onRetry?: ((message: string) => void) | false;
  /** Space requests out (see `pacedJev`). Default: no pacing. */
  pace?: PaceOptions | false;
  /**
   * The most questions to send in one request; more are split over several requests (each with the
   * whole state). Default: the model's known limit ({@link KNOWN_LIMITS}), otherwise none.
   */
  maxQuestions?: number;
  /**
   * The most input tokens to send in one request, as estimated before sending
   * ({@link estimateOpenRouterTokens}); bigger requests are split like `maxQuestions`. Default: the
   * smallest known limit among the hosts the request may go to (the one host in `provider.order`
   * when `allow_fallbacks` is false, otherwise every host listed for the model), otherwise none.
   */
  maxTokens?: number;
  /** Extra headers, such as OpenRouter's optional `HTTP-Referer` and `X-Title`. */
  headers?: Record<string, string>;
  /**
   * Check requests before sending and answers after (both on by default). Off only to probe what a
   * model does with a request it may refuse.
   */
  strict?: boolean;
  /** For tests. */
  fetch?: typeof fetch;
}

/** What OpenRouter adds to a System One response. */
export interface OpenRouterResponse extends SystemOneResponse {
  /** OpenRouter's generation id (`gen-dec-…`). */
  id?: string;
  /** Who served the request ("TypeSafe", "Cloudflare", …). */
  provider?: string;
  usage?: { input_tokens: number; output_tokens: number; cost?: number };
}

/** An error from OpenRouter, or a request or answer this client won't pass on. */
export class OpenRouterError extends Error {
  constructor(
    message: string,
    /** The HTTP status, when there was a response. */
    readonly status?: number,
    /**
     * `"request"`: refused before sending; `"answer"`: an answer the readings can't use;
     * `"refused"`: the model declined a question (OpenRouter fails the whole request);
     * `"too-big"`: the host says even one question is over its token limit; `"http"`: any other
     * error from OpenRouter.
     */
    readonly kind: "request" | "answer" | "refused" | "too-big" | "http" = "http",
    readonly model?: string,
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

/** A model's per-request limits on OpenRouter, where its hosts refuse more. */
export interface ModelLimits {
  maxQuestions?: number;
  /** Input tokens per request, by host (OpenRouter's provider tag, such as `cloudflare`). */
  maxTokens?: Record<string, number>;
}

/**
 * Known limits, by model id. Clef's and Clef Flash's hosts answer 422 above 64 questions (checked
 * 2026-10-14). Tokens, checked 2026-10-17:
 * - Prime Intellect lists Clef with a 16,384-token context, and fails anything over it with a bare
 *   "Invalid request." Clef Flash there fails the same way above about 11,000 tokens, with no
 *   listing; taken to be the same.
 * - Cloudflare says so: "the maximum is 65529" for Clef and "24576" for Clef Flash (its listing
 *   says 65,536 for both).
 * - DeepInfra lists Clef with 65,536 (not tried).
 */
export const KNOWN_LIMITS: Record<string, ModelLimits> = {
  "cloudflare/clef": { maxQuestions: 64, maxTokens: { primeintellect: 16_384, cloudflare: 65_529, deepinfra: 65_536 } },
  "cloudflare/clef-flash": { maxQuestions: 64, maxTokens: { primeintellect: 16_384, cloudflare: 24_576 } },
};

/**
 * The limits a request to `model` is held to: `maxQuestions` and `maxTokens` if given; otherwise
 * the known ones, for the hosts the routing allows (see {@link OpenRouterOptions.maxTokens}).
 */
export function limitsFor(model: string, provider?: Record<string, unknown>, given: { maxQuestions?: number; maxTokens?: number } = {}): { maxQuestions: number; maxTokens: number } {
  for (const [k, v] of Object.entries(given)) if (v !== undefined && !(v >= 1)) throw new Error(`openRouter: ${k} must be at least 1, not ${v}`);
  const known = KNOWN_LIMITS[model.split(":")[0]!] ?? {};
  const order = Array.isArray(provider?.order) ? (provider.order as unknown[]).map((h) => String(h).toLowerCase().split("/")[0]!) : undefined;
  const pinned = order && order.length && provider?.allow_fallbacks === false ? order : undefined;
  const hosts = Object.entries(known.maxTokens ?? {}).filter(([h]) => !pinned || pinned.includes(h));
  return {
    maxQuestions: given.maxQuestions ?? known.maxQuestions ?? Number.POSITIVE_INFINITY,
    maxTokens: given.maxTokens ?? (hosts.length ? Math.min(...hosts.map(([, n]) => n)) : Number.POSITIVE_INFINITY),
  };
}

/** Clef's hosts counted as few as 2.04 characters of request JSON per token; this counts 2. */
export const OPENROUTER_CHARS_PER_TOKEN = 2;
/** A fixed allowance per request, on top of the characters. */
export const OPENROUTER_OVERHEAD_TOKENS = 250;

/** Input tokens for a request, estimated on the high side for splitting by `maxTokens`. */
export function estimateOpenRouterTokens(state: unknown, questions: Record<string, Question>): number {
  return OPENROUTER_OVERHEAD_TOKENS + Math.ceil(JSON.stringify({ state, questions }).length / OPENROUTER_CHARS_PER_TOKEN);
}

/**
 * Questions in parts that keep within both limits, in order. Each part goes with the whole state.
 * The estimate errs high (some requests run to 4 characters a token), so a question that looks too
 * big on its own is still sent, alone, and the host decides.
 */
export function splitForLimits(state: unknown, questions: Record<string, Question>, limits: { maxQuestions: number; maxTokens: number }): Record<string, Question>[] {
  const entries = Object.entries(questions);
  if (entries.length <= limits.maxQuestions && estimateOpenRouterTokens(state, questions) <= limits.maxTokens) return [questions];
  const base = estimateOpenRouterTokens(state, {});
  const sizeOf = ([id, q]: [string, Question]) => Math.ceil((JSON.stringify(id).length + JSON.stringify(q).length + 2) / OPENROUTER_CHARS_PER_TOKEN);
  const parts: [string, Question][][] = [];
  let cur: [string, Question][] = [];
  let tokens = base;
  for (const e of entries) {
    const size = sizeOf(e);
    if (cur.length && (cur.length >= limits.maxQuestions || tokens + size > limits.maxTokens)) {
      parts.push(cur);
      cur = [];
      tokens = base;
    }
    cur.push(e);
    tokens += size;
  }
  if (cur.length) parts.push(cur);
  return parts.map((p) => Object.fromEntries(p));
}

const DEFAULT_RETRY: Required<OpenRouterRetry> = { maxRetries: 5, backoffInitialMs: 1_000, backoffMaxMs: 16_000 };
const env = (name: string): string | undefined => (typeof process !== "undefined" ? process.env?.[name] : undefined);
const retryable = (status: number) => status === 408 || status === 429 || status >= 500;

export function openRouter(opts: OpenRouterOptions): SystemOneClient {
  const apiKey = opts.apiKey ?? env("OPENROUTER_API_KEY");
  if (!apiKey) throw new Error("openRouter: no API key (pass apiKey or set OPENROUTER_API_KEY)");
  if (!opts.model) throw new Error("openRouter: a model is required, such as typesafe/jev-1.13");
  const url = `${(opts.baseURL ?? env("OPENROUTER_BASE_URL") ?? OPENROUTER_BASE_URL).replace(/\/+$/, "")}${DECISIONS_PATH}`;
  const retry = { ...DEFAULT_RETRY, ...opts.retry };
  const tell = opts.onRetry === false ? undefined : (opts.onRetry ?? ((m: string) => console.error(`openrouter: ${m}`)));
  const doFetch = opts.fetch ?? fetch;
  const strict = opts.strict !== false;

  /** One request to OpenRouter, with no more questions than the model's limit. */
  async function post(request: SystemOneRequest, model: string): Promise<OpenRouterResponse> {
    const ids = wireIds(Object.keys(request.questions));
    const questions = Object.fromEntries(Object.entries(request.questions).map(([id, q]) => [ids.toWire.get(id) ?? id, q]));
    // Only what the API takes: never `meta`.
    const body = JSON.stringify({ model, state: request.state, questions, ...(opts.provider ? { provider: opts.provider } : {}) });
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", ...opts.headers },
          body,
          signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
        });
      } catch (err) {
        // Timeouts and dropped connections.
        if (attempt >= retry.maxRetries) throw new OpenRouterError(`OpenRouter request failed: ${String(err)}`, undefined, "http", model);
        await wait(backoff(attempt, retry), `retry ${attempt + 1}/${retry.maxRetries} after ${String(err).slice(0, 60)}`, tell);
        continue;
      }
      if (res.ok) {
        const parsed = await readJson(res, model);
        if (ids.fromWire.size && parsed.answers) parsed.answers = Object.fromEntries(Object.entries(parsed.answers).map(([w, a]) => [ids.fromWire.get(w) ?? w, a]));
        return parsed;
      }
      let message = await errorMessage(res);
      for (const [w, id] of ids.fromWire) message = message.split(`"${w}"`).join(`"${id}"`);
      // A model declining a question comes back as a 502 for the whole request; asking again
      // gets the same answer, so it isn't retried.
      const refused = /refused to answer/i.test(message);
      if (retryable(res.status) && !refused && attempt < retry.maxRetries) {
        await wait(retryAfter(res) ?? backoff(attempt, retry), `retry ${attempt + 1}/${retry.maxRetries} after ${res.status}`, tell);
        continue;
      }
      const tooBig = res.status < 500 && /requires \d+ tokens; the maximum is \d+/i.test(message);
      throw new OpenRouterError(`OpenRouter ${res.status} for ${model}: ${message}`, res.status, refused ? "refused" : tooBig ? "too-big" : "http", model);
    }
  }

  /** A part, sent; if the host says it's too big, sent again in halves. */
  async function postPart(request: SystemOneRequest, model: string): Promise<OpenRouterResponse> {
    try {
      return await post(request, model);
    } catch (err) {
      const entries = Object.entries(request.questions);
      if (!(err instanceof OpenRouterError && err.kind === "too-big") || entries.length < 2) throw err;
      const half = Math.ceil(entries.length / 2);
      const halves = [entries.slice(0, half), entries.slice(half)].map((e) => postPart({ ...request, questions: Object.fromEntries(e) }, model));
      return merge(await Promise.all(halves));
    }
  }

  const direct: SystemOneClient = {
    async systemOne(request: SystemOneRequest): Promise<OpenRouterResponse> {
      const model = request.model ?? opts.model;
      if (strict) checkRequest(request, model);
      const limits = limitsFor(model, opts.provider, { maxQuestions: opts.maxQuestions, maxTokens: opts.maxTokens });
      const parts = splitForLimits(request.state, request.questions, limits);
      const response = parts.length === 1 ? await postPart(request, model) : merge(await Promise.all(parts.map((questions) => postPart({ ...request, questions }, model))));
      if (strict) checkAnswers(request, response, model);
      return response;
    },
  };
  return opts.pace ? pacedJev(direct, opts.pace) : direct;
}

/** The answers of several requests as one response; usage and cost are summed. */
function merge(responses: OpenRouterResponse[]): OpenRouterResponse {
  const [first] = responses as [OpenRouterResponse, ...OpenRouterResponse[]];
  const out: OpenRouterResponse = { ...first, answers: Object.assign({}, ...responses.map((r) => r.answers)) };
  if (responses.every((r) => r.usage)) {
    const sum = (f: (u: NonNullable<OpenRouterResponse["usage"]>) => number | undefined) => responses.reduce((t, r) => t + (f(r.usage!) ?? 0), 0);
    out.usage = { input_tokens: sum((u) => u.input_tokens), output_tokens: sum((u) => u.output_tokens) };
    if (responses.every((r) => r.usage!.cost !== undefined)) out.usage.cost = sum((u) => u.cost);
  } else delete out.usage;
  return out;
}

const SAFE_ID = /^[A-Za-z0-9_.-]{1,100}$/;

/**
 * Wire names for ids some hosts refuse: other characters become "_", long ids are cut to 100
 * characters, and a number is added if the name is taken.
 */
export function wireIds(ids: string[]): { toWire: Map<string, string>; fromWire: Map<string, string> } {
  const toWire = new Map<string, string>();
  const fromWire = new Map<string, string>();
  const taken = new Set(ids.filter((id) => SAFE_ID.test(id)));
  for (const id of ids) {
    if (SAFE_ID.test(id)) continue;
    const base = (id.replace(/[^A-Za-z0-9_.-]+/g, "_") || "q").slice(0, 100);
    let wire = base;
    for (let n = 2; taken.has(wire); n++) wire = `${base.slice(0, 100 - `_${n}`.length)}_${n}`;
    taken.add(wire);
    toWire.set(id, wire);
    fromWire.set(wire, id);
  }
  return { toWire, fromWire };
}

/**
 * What OpenRouter (or every model behind it) can't take, found before sending: a Noul whose
 * criteria give one side only. Give both sides, or none.
 */
export function checkRequest(request: SystemOneRequest, model?: string): void {
  for (const [id, q] of Object.entries(request.questions)) {
    if (q.type !== "noul" || !q.criteria) continue;
    const has = (k: "true" | "false") => q.criteria![k] !== undefined && q.criteria![k] !== null;
    if (has("true") !== has("false")) {
      throw new OpenRouterError(`question "${id}": a Noul's criteria need both "true" and "false", or neither (OpenRouter refuses one side)`, undefined, "request", model);
    }
  }
}

/** Every question answered, with the fields the readings use. */
export function checkAnswers(request: SystemOneRequest, response: SystemOneResponse, model?: string): void {
  const served = response.model ?? model;
  for (const [id, q] of Object.entries(request.questions)) {
    const a = response.answers?.[id] as (Answer & { probabilities?: unknown }) | undefined;
    if (a === undefined) throw new OpenRouterError(`${served} gave no answer for question "${id}"`, undefined, "answer", served);
    const problem = answerProblem(q, a);
    if (problem) throw new OpenRouterError(`${served}, question "${id}": ${problem}`, undefined, "answer", served);
  }
}

function answerProblem(q: Question, a: Answer & { probabilities?: unknown; type?: string }): string | undefined {
  if (a.type !== undefined && a.type !== q.type) return `asked a ${q.type}, got a ${a.type} answer`;
  if (q.type === "noul") return typeof (a as { noul?: unknown }).noul === "number" ? undefined : "no probability (`noul`) in the answer";
  if (typeof a.probabilities !== "object" || a.probabilities === null || !Object.keys(a.probabilities).length) return "no `probabilities` in the answer";
  return undefined;
}

async function readJson(res: Response, model: string): Promise<OpenRouterResponse> {
  const type = res.headers.get("content-type") ?? "";
  const text = await res.text();
  // A wrong path can come back as OpenRouter's web page with status 200.
  if (!type.includes("json")) throw new OpenRouterError(`OpenRouter answered with ${type || "no content type"} instead of JSON (is baseURL right? it should end in /api): ${text.slice(0, 80)}`, res.status, "http", model);
  try {
    return JSON.parse(text) as OpenRouterResponse;
  } catch {
    throw new OpenRouterError(`OpenRouter answered with JSON that doesn't parse: ${text.slice(0, 80)}`, res.status, "http", model);
  }
}

async function errorMessage(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const j = JSON.parse(text) as { error?: { message?: string; metadata?: unknown } };
    const meta = j.error?.metadata ? ` ${JSON.stringify(j.error.metadata).slice(0, 300)}` : "";
    return `${j.error?.message ?? text.slice(0, 300)}${meta}`;
  } catch {
    return text.slice(0, 300);
  }
}

function backoff(attempt: number, r: Required<OpenRouterRetry>): number {
  const base = Math.min(r.backoffMaxMs, r.backoffInitialMs * 2 ** attempt);
  return Math.round(base * (1 - Math.random() * 0.25));
}

/** `Retry-After` in seconds or as a date, up to a minute. */
function retryAfter(res: Response): number | undefined {
  const h = res.headers.get("retry-after");
  if (!h) return undefined;
  const s = Number(h);
  const ms = Number.isFinite(s) ? s * 1000 : Date.parse(h) - Date.now();
  return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, 60_000) : undefined;
}

async function wait(ms: number, why: string, tell?: (m: string) => void): Promise<void> {
  tell?.(`retrying in ${ms}ms (${why})`);
  await new Promise((r) => setTimeout(r, ms));
}
