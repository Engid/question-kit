// Every Jev request a strategy makes goes through a CallLog. It sends the questions, splits a
// request that would be too big, and keeps a record of each call (questions, answers, timing,
// tokens) for `bun run explain` and the eval's report card.
//
// A call can carry several question sets at once. Jev answers every question in a request
// independently ("One question's answer is not hidden context for another":
// https://docs.typesafe.ai/primitives.md), so anything that can be asked at the same time
// should be, and anything that depends on an earlier answer needs a later call.

import { type Answer, type ChoiceAnswer, choiceAnswer, type Entry, type JevClient, type JevRequest, type JevResponse, noulAnswer, type Question } from "./jev/types.ts";

/** What a question is about, in word ids, so answers can be explained and checked against the treebank. */
export interface QuestionMeta {
  /** Which question set asked it (see src/question-sets/). */
  set: string;
  /** The word the question is about. */
  word?: number;
  /** For questions about two neighboring words. */
  pair?: [number, number];
  /** For relationship questions: the word it attaches to. */
  head?: number;
  /** For phrase questions: the words of the phrase the question is about. */
  phrase?: number[];
  /** For two-level questions: which level ("kind" or a specific group). */
  level?: string;
  /** For questions about one item of an order (examples/pizza): its index, from 1. */
  item?: number;
  /** For questions about one menu entry (examples/pizza): its id, e.g. "OLIVES". */
  entity?: string;
  /** For questions that check an order (examples/pizza): what is checked as an EXR tree, or one per option. */
  exr?: string | Record<string, string>;
  /**
   * What each option means: a word id (0 = root), a list of word ids (a phrase), or a label like
   * "outside". Lets explain print "across" instead of "w7".
   */
  options?: Record<string, number | number[] | string>;
}

export interface AskedQuestion {
  question: Question;
  meta: QuestionMeta;
}

/** A batch of questions from one question set, keyed by question id. */
export type QuestionBatch = Record<string, AskedQuestion>;

export type Answers = Record<string, Answer>;

export interface CallRecord {
  /** Plain-English name of the call, e.g. "word types + attachments". */
  title: string;
  /** Which part of the call this was, when a big call was split into several requests. */
  part: number;
  parts: number;
  request: JevRequest;
  response: JevResponse;
  meta: Record<string, QuestionMeta>;
  ms: number;
}

/** Something code did, and how many requests had been made at that point. */
export interface CodeStep {
  afterRequest: number;
  text: string;
}

export interface CallStats {
  requests: number;
  questions: number;
  jevMs: number;
  inputTokens: number;
  outputTokens: number;
  /** Size of the request bodies (JSON characters): a cost estimate that works without the API. */
  requestChars: number;
}

/**
 * Characters per input token, used to estimate request size before sending. Live runs measured
 * about 2.9 JSON characters per Jev input token (2026-10-06); 2.5 errs toward over-estimating.
 */
export const CHARS_PER_TOKEN_ESTIMATE = 2.5;

/**
 * TypeSafe documents a context limit of 64k tokens per request (https://docs.typesafe.ai/models.md).
 * A call bigger than this estimate is sent as several requests.
 */
export const MAX_REQUEST_TOKENS = 48_000;

export class CallLog {
  readonly calls: CallRecord[] = [];
  /** Plain-English notes about what code did between calls, for explain. */
  readonly steps: CodeStep[] = [];
  readonly stats: CallStats = { requests: 0, questions: 0, jevMs: 0, inputTokens: 0, outputTokens: 0, requestChars: 0 };

  constructor(
    private readonly jev: JevClient,
    private readonly maxRequestTokens = MAX_REQUEST_TOKENS,
  ) {}

  /** Ask every question in `batches` about `state` in one call, and return all the answers. */
  async call(title: string, state: Entry, ...batches: QuestionBatch[]): Promise<Answers> {
    const asked: QuestionBatch = Object.assign({}, ...batches);
    const ids = Object.keys(asked);
    const answers: Answers = {};
    if (ids.length === 0) return answers;
    const parts = this.split(state, asked);
    for (const [i, part] of parts.entries()) {
      const questions = Object.fromEntries(part.map((id) => [id, (asked[id] as AskedQuestion).question]));
      const meta = Object.fromEntries(part.map((id) => [id, (asked[id] as AskedQuestion).meta]));
      const request: JevRequest = { state, questions, meta };
      const t0 = performance.now();
      const response = await this.jev.systemOne(request);
      const ms = performance.now() - t0;
      this.calls.push({ title, part: i, parts: parts.length, request, response, meta, ms });
      this.stats.requests++;
      this.stats.questions += part.length;
      this.stats.requestChars += JSON.stringify({ state, questions }).length;
      this.stats.jevMs += ms;
      this.stats.inputTokens += response.usage?.input_tokens ?? 0;
      this.stats.outputTokens += response.usage?.output_tokens ?? 0;
      Object.assign(answers, response.answers);
    }
    return answers;
  }

  note(text: string): void {
    this.steps.push({ afterRequest: this.calls.length, text });
  }

  /** Pack question ids into requests under the size limit, keeping their order. */
  private split(state: Entry, asked: QuestionBatch): string[][] {
    const base = JSON.stringify({ state, questions: {} }).length;
    const out: string[][] = [];
    let cur: string[] = [];
    let chars = base;
    for (const [id, q] of Object.entries(asked)) {
      const size = JSON.stringify({ [id]: q.question }).length;
      if (cur.length > 0 && (chars + size) / CHARS_PER_TOKEN_ESTIMATE > this.maxRequestTokens) {
        out.push(cur);
        cur = [];
        chars = base;
      }
      cur.push(id);
      chars += size;
    }
    if (cur.length > 0) out.push(cur);
    return out;
  }
}

/** Read a Choice answer by question id. */
export function choiceOf(answers: Answers, id: string): ChoiceAnswer {
  return choiceAnswer({ model: "", answers }, id);
}

/** Read a Noul answer by question id: the probability of "yes". */
export function noulOf(answers: Answers, id: string): number {
  return noulAnswer({ model: "", answers }, id).noul;
}
