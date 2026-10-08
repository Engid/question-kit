// The wire format of a System One request, and sending one.
//
// These mirror TypeSafe's API (`POST /v1/systemone`). Any client with a `systemOne(request)` method
// works: TypeSafe's SDK wrapped in a few lines, an answer cache, or a fake for tests (`fakeJev`).

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Text, a JSON object or array, or null: what state, instructions and descriptions may be. */
export type Entry = string | { [key: string]: Json } | Json[] | null;

export interface NoulQuestion {
  type: "noul";
  instructions: Entry;
  criteria?: { true?: Entry; false?: Entry } | null;
}

export interface ChoiceQuestion {
  type: "choice";
  instructions: Entry;
  /** Option id → description (or null). */
  criteria: Record<string, Entry>;
}

export interface ScoreQuestion {
  type: "score";
  instructions: Entry;
  /** One description per level, lowest first. */
  criteria: Entry[];
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface JevRequest {
  state: Entry;
  questions: Record<string, Question>;
  model?: string;
  /** Not part of the API: what each question is about, for logs and fakes. Clients must not send it. */
  meta?: Record<string, unknown>;
}

export interface NoulAnswer {
  type?: "noul";
  /** Probability of yes. */
  noul: number;
}

export interface ChoiceAnswer {
  type?: "choice";
  choice: string;
  confidence?: number;
  probabilities: Record<string, number>;
}

export interface ScoreAnswer {
  type?: "score";
  /** Probability-weighted mean of the level numbers (0 = first level). */
  score: number;
  confidence?: number;
  probabilities: Record<string, number>;
}

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface JevResponse {
  model?: string;
  answers: Record<string, Answer>;
  usage?: { input_tokens: number; output_tokens: number };
}

/** Anything that answers a System One request. */
export interface JevClient {
  systemOne(request: JevRequest): Promise<JevResponse>;
}

/** One request and its answers, for logs, explaining a result, and cost. */
export interface JevCall {
  title: string;
  /** Which request this was, when a big one was split into several. */
  part: number;
  parts: number;
  request: JevRequest;
  response: JevResponse;
  ms: number;
}

export interface SendOptions {
  /** Every request made is pushed here. */
  log?: JevCall[];
  /** A label for the log. */
  title?: string;
  model?: string;
  /** What each question is about; never sent. */
  meta?: Record<string, unknown>;
}

/**
 * Estimating input tokens before sending: a fixed cost per request plus the request's JSON length
 * divided by characters per token. Fitted on 55 live requests (2026-10-07): about 253 tokens per
 * request plus one per 3.1 characters. These round toward over-estimating.
 */
export const REQUEST_OVERHEAD_TOKENS = 250;
export const CHARS_PER_TOKEN = 3;
/** TypeSafe documents a 64k-token context; stay well under it. */
export const MAX_REQUEST_TOKENS = 48_000;
/** TypeSafe's limit on options in one Choice. */
export const MAX_CHOICE_OPTIONS = 255;
/** TypeSafe's list price per million input tokens for jev models (output is free). */
export const PRICE_PER_MILLION_INPUT = 0.042;

/** Estimated input tokens for a request. */
export function estimateTokens(state: Entry, questions: Record<string, Question>): number {
  return REQUEST_OVERHEAD_TOKENS + JSON.stringify({ state, questions }).length / CHARS_PER_TOKEN;
}

/**
 * Ask every question about one state in one request, splitting into several requests only if it
 * would be too big. Jev answers each question independently, so splitting doesn't change answers.
 */
export async function send(jev: JevClient, state: Entry, questions: Record<string, Question>, opts: SendOptions = {}): Promise<Record<string, Answer>> {
  const answers: Record<string, Answer> = {};
  const ids = Object.keys(questions);
  if (!ids.length) return answers;
  const parts = split(state, questions);
  for (const [i, part] of parts.entries()) {
    const request: JevRequest = {
      state,
      questions: Object.fromEntries(part.map((id) => [id, questions[id]!])),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.meta ? { meta: Object.fromEntries(part.filter((id) => id in opts.meta!).map((id) => [id, opts.meta![id]])) } : {}),
    };
    const t0 = performance.now();
    const response = await jev.systemOne(request);
    opts.log?.push({ title: opts.title ?? "", part: i, parts: parts.length, request, response, ms: performance.now() - t0 });
    for (const id of part) {
      const a = response.answers[id];
      if (a === undefined) throw new Error(`Jev returned no answer for question "${id}"`);
      answers[id] = a;
    }
  }
  return answers;
}

function split(state: Entry, questions: Record<string, Question>): string[][] {
  const base = JSON.stringify({ state, questions: {} }).length;
  const out: string[][] = [];
  let cur: string[] = [];
  let chars = base;
  for (const [id, q] of Object.entries(questions)) {
    const size = JSON.stringify({ [id]: q }).length;
    if (cur.length > 0 && REQUEST_OVERHEAD_TOKENS + (chars + size) / CHARS_PER_TOKEN > MAX_REQUEST_TOKENS) {
      out.push(cur);
      cur = [];
      chars = base;
    }
    cur.push(id);
    chars += size;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Estimated cost in dollars of the requests in a log, from their size. */
export function estimateCost(log: JevCall[]): number {
  let tokens = 0;
  for (const c of log) tokens += c.response.usage?.input_tokens || estimateTokens(c.request.state, c.request.questions);
  return (tokens / 1e6) * PRICE_PER_MILLION_INPUT;
}

/**
 * A client for tests: `answer(id, question, state)` returns each answer. A Choice answer can be
 * given as just the chosen option, a Noul answer as a probability, and a Score answer as
 * `{ level }`.
 */
export function fakeJev(answer: (id: string, question: Question, state: Entry) => Answer | string | number | { level: number }): JevClient & { requests: JevRequest[] } {
  const requests: JevRequest[] = [];
  return {
    requests,
    async systemOne(request) {
      requests.push(request);
      const answers: Record<string, Answer> = {};
      for (const [id, q] of Object.entries(request.questions)) answers[id] = expand(q, answer(id, q, request.state));
      return { model: "fake", answers };
    },
  };
}

function expand(q: Question, a: Answer | string | number | { level: number }): Answer {
  if (typeof a === "object" && a !== null && !("level" in a)) return a;
  if (q.type === "noul") return { type: "noul", noul: typeof a === "number" ? a : a === "yes" || a === "true" ? 0.95 : 0.05 };
  if (q.type === "choice") {
    const keys = Object.keys(q.criteria);
    const pick = typeof a === "string" ? a : keys[0]!;
    const rest = (1 - 0.9) / Math.max(1, keys.length - 1);
    return { type: "choice", choice: pick, probabilities: Object.fromEntries(keys.map((k) => [k, k === pick ? (keys.length === 1 ? 1 : 0.9) : rest])) };
  }
  const n = q.criteria.length;
  const level = typeof a === "object" && a !== null && "level" in a ? a.level : typeof a === "number" ? a : 0;
  return { type: "score", score: level, probabilities: Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i), i === level ? 1 : 0])) };
}
