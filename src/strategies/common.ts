import type { JevClient, JevRequest, JevResponse, Questions } from "../jev/types.ts";
import { tokenize } from "../tokenize.ts";
import type { Edge, ParseInput, ParsedToken, ParseStats, TraceEntry } from "../types.ts";
import { writeConllu } from "../ud/conllu.ts";

export function normalizeInput(input: ParseInput): { words: string[]; text: string } {
  if (typeof input === "string") {
    const words = tokenize(input).map((t) => t.form);
    return { words, text: input.trim() };
  }
  return { words: input.words, text: input.text ?? input.words.join(" ") };
}

/**
 * Characters per input token used to estimate request size before sending. Live runs measured
 * about 2.9 JSON characters per Jev input token (2026-10-06); 2.5 errs toward over-estimating.
 */
export const CHARS_PER_TOKEN_ESTIMATE = 2.5;

/**
 * TypeSafe's documented context limit is 64k tokens per request ("32k tokens for `state` plus the
 * longest question"): https://docs.typesafe.ai/models.md. We split below that, with margin.
 */
export const DEFAULT_MAX_REQUEST_TOKENS = 48_000;

export function emptyStats(): ParseStats {
  return {
    requests: 0,
    questions: 0,
    jevMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    requestChars: 0,
    argmaxDisagreements: 0,
    argmaxMutualPairs: 0,
  };
}

export interface SessionLimits {
  /** Split when a request would have more questions than this (0 = no cap). */
  maxQuestionsPerRequest?: number;
  /** Split when a request's estimated input tokens would exceed this (0 = no cap). */
  maxRequestTokens?: number;
}

/** Sends requests and keeps the trace and the counters every strategy reports. */
export class Session {
  readonly trace: TraceEntry[] = [];
  readonly stats: ParseStats = emptyStats();

  constructor(
    private readonly client: JevClient,
    private readonly limits: SessionLimits = {},
  ) {}

  /** Pack question ids into requests that respect the limits, in their original order. */
  plan(state: JevRequest["state"], questions: Questions): string[][] {
    const maxQ = this.limits.maxQuestionsPerRequest ?? 0;
    const maxTok = this.limits.maxRequestTokens ?? 0;
    const base = JSON.stringify({ state, questions: {} }).length;
    const batches: string[][] = [];
    let batch: string[] = [];
    let chars = base;
    for (const [id, q] of Object.entries(questions)) {
      const qChars = JSON.stringify({ [id]: q }).length;
      const tooMany = maxQ > 0 && batch.length >= maxQ;
      const tooBig = maxTok > 0 && (chars + qChars) / CHARS_PER_TOKEN_ESTIMATE > maxTok;
      if (batch.length > 0 && (tooMany || tooBig)) {
        batches.push(batch);
        batch = [];
        chars = base;
      }
      batch.push(id);
      chars += qChars;
    }
    if (batch.length > 0) batches.push(batch);
    return batches;
  }

  /** Ask `questions` about `state`, split into as many requests as the limits require. */
  async ask(stage: string, state: JevRequest["state"], questions: Questions): Promise<JevResponse> {
    const batches = this.plan(state, questions);
    const merged: JevResponse = { model: "", answers: {}, usage: { input_tokens: 0, output_tokens: 0 } };
    for (const [i, ids] of batches.entries()) {
      const part: Questions = {};
      for (const id of ids) part[id] = questions[id] as Questions[string];
      const request: JevRequest = { state, questions: part };
      const t0 = performance.now();
      const response = await this.client.systemOne(request);
      const ms = performance.now() - t0;
      this.trace.push({ stage: batches.length > 1 ? `${stage}[${i}]` : stage, request, response, ms });
      this.stats.requests++;
      this.stats.questions += ids.length;
      this.stats.requestChars += JSON.stringify(request).length;
      this.stats.jevMs += ms;
      this.stats.inputTokens += response.usage?.input_tokens ?? 0;
      this.stats.outputTokens += response.usage?.output_tokens ?? 0;
      merged.model = response.model;
      Object.assign(merged.answers, response.answers);
      if (merged.usage && response.usage) {
        merged.usage.input_tokens += response.usage.input_tokens;
        merged.usage.output_tokens += response.usage.output_tokens;
      }
    }
    return merged;
  }
}

/** True when a model judged this edge (rule baselines leave the head distribution empty). */
export function isJudged(e: Edge): boolean {
  return Object.keys(e.headDist).length > 0;
}

/** Separation for display: when the runner-up got ~0, the ratio is meaningless beyond "very large". */
export function fmtSep(s: number): string {
  if (!Number.isFinite(s)) return "—";
  return s >= 1000 ? "1000+" : s.toFixed(2);
}

export function toConllu(text: string, tokens: ParsedToken[], edges: Edge[], strategy: string): string {
  const byDep = new Map(edges.map((e) => [e.dep, e]));
  return writeConllu(
    tokens.map((t) => {
      const e = byDep.get(t.id);
      const misc = e && isJudged(e) ? `JevP=${e.p.toFixed(3)}|JevSep=${fmtSep(e.separation)}` : undefined;
      return { form: t.form, upos: t.upos, head: e?.head, deprel: e?.deprel, misc };
    }),
    { text, comments: [`# parser = system-one-parsers/${strategy}`] },
  );
}
