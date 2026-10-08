// The little the order taker needs from Jev: send a System One request, get answers back.
//
// Any client with a `systemOne(request)` method works: TypeSafe's SDK wrapped in a few lines, a
// cache, or a fake for tests. Requests carry a `meta` field saying what each question is about; it
// is for logs and test doubles, and a client must not send it to the API.

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type Entry = string | { [key: string]: Json } | Json[] | null;

export type Question =
  | { type: "choice"; instructions?: Entry; criteria: Record<string, Entry> }
  | { type: "noul"; instructions?: Entry; criteria?: { true?: Entry; false?: Entry } | null };

export interface JevRequest {
  state: Entry;
  questions: Record<string, Question>;
  model?: string;
  /** Not part of the API: what each question is about. Never sent. */
  meta?: Record<string, unknown>;
}

export type Answer =
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "noul"; noul: number }
  | { type: "score"; score: number; confidence: number; probabilities: Record<string, number> };

export interface JevResponse {
  model: string;
  answers: Record<string, Answer>;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface JevClient {
  systemOne(request: JevRequest): Promise<JevResponse>;
}

/** A question plus what it is about (kept in `meta`, never sent). */
export interface Asked {
  question: Question;
  about: Record<string, unknown>;
}

/** One request and its answers, for logging and explaining an order. */
export interface JevCall {
  title: string;
  /** Which request this was, when a big call was split into several. */
  part: number;
  parts: number;
  request: JevRequest;
  response: JevResponse;
  ms: number;
}

/**
 * Characters per input token for estimating a request's size before sending. Live runs measured
 * about 2.9 JSON characters per Jev input token; 2.5 errs toward over-estimating.
 */
const CHARS_PER_TOKEN = 2.5;
/** TypeSafe documents a 64k-token context per request (https://docs.typesafe.ai/models.md). */
const MAX_REQUEST_TOKENS = 48_000;

/**
 * Ask every question about `state` in one call, split into several requests if it would be too
 * big, and return all the answers. Jev answers each question independently, so splitting doesn't
 * change them.
 */
export async function ask(jev: JevClient, log: JevCall[], title: string, state: Entry, asked: Record<string, Asked>): Promise<Record<string, Answer>> {
  const answers: Record<string, Answer> = {};
  const ids = Object.keys(asked);
  if (!ids.length) return answers;
  const parts = split(state, asked);
  for (const [i, part] of parts.entries()) {
    const request: JevRequest = {
      state,
      questions: Object.fromEntries(part.map((id) => [id, asked[id]!.question])),
      meta: Object.fromEntries(part.map((id) => [id, asked[id]!.about])),
    };
    const t0 = performance.now();
    const response = await jev.systemOne(request);
    log.push({ title, part: i, parts: parts.length, request, response, ms: performance.now() - t0 });
    Object.assign(answers, response.answers);
  }
  return answers;
}

function split(state: Entry, asked: Record<string, Asked>): string[][] {
  const base = JSON.stringify({ state, questions: {} }).length;
  const out: string[][] = [];
  let cur: string[] = [];
  let chars = base;
  for (const [id, q] of Object.entries(asked)) {
    const size = JSON.stringify({ [id]: q.question }).length;
    if (cur.length > 0 && (chars + size) / CHARS_PER_TOKEN > MAX_REQUEST_TOKENS) {
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

/** A Choice answer's top option and its probability. */
export function topChoice(a: Answer | undefined): [string, number] | undefined {
  if (!a || !("probabilities" in a)) return undefined;
  let best: [string, number] = ["", -1];
  for (const [k, p] of Object.entries(a.probabilities)) if (p > best[1]) best = [k, p];
  return best;
}

/** A Noul answer's probability of yes. */
export function yes(a: Answer | undefined): number | undefined {
  return a && "noul" in a ? a.noul : undefined;
}
