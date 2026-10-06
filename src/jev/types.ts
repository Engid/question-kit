// Wire types for a System One request, mirroring TypeSafe's API (`POST /v1/systemone`) and the
// `@typesafe-ai/sdk` 0.6.0 type definitions. They're declared here rather than imported so the
// parser doesn't depend on one vendor's SDK; `live.ts` is the only file that touches the SDK.

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Text, a JSON object or array, or null: what state, instructions and criteria may be. */
export type Entry = string | { [key: string]: Json } | Json[] | null;

export interface NoulQuestion {
  type: "noul";
  instructions?: Entry;
  criteria?: { true?: Entry; false?: Entry } | null;
}

export interface ChoiceQuestion {
  type: "choice";
  instructions?: Entry;
  /** Option id → description. TypeSafe documents a limit of 255 options. */
  criteria: Record<string, Entry>;
}

export interface ScoreQuestion {
  type: "score";
  instructions?: Entry;
  criteria: Entry[];
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type Questions = Record<string, Question>;

export interface JevRequest {
  state: Entry;
  questions: Questions;
  model?: string;
  /**
   * Not sent to Jev. What each question is about (see src/calls.ts), so test doubles like the
   * gold-tree oracle can answer, and so recorded calls can be explained later.
   */
  meta?: Record<string, unknown>;
}

export interface NoulAnswer {
  type: "noul";
  /** Probability of yes. */
  noul: number;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
  legend?: Record<string, Entry>;
}

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface JevResponse {
  model: string;
  answers: Record<string, Answer>;
  usage?: { input_tokens: number; output_tokens: number };
}

/** Anything that answers a System One request: the live API, a cache, or a test double. */
export interface JevClient {
  readonly name: string;
  systemOne(request: JevRequest): Promise<JevResponse>;
}

/** TypeSafe's documented maximum number of options in one Choice. */
export const MAX_CHOICE_OPTIONS = 255;

// The SDK's types say every answer carries `type`; these readers also accept an answer without it,
// as long as it has the fields of that kind.
export function choiceAnswer(res: JevResponse, id: string): ChoiceAnswer {
  const a = res.answers[id] as Partial<ChoiceAnswer> | undefined;
  if (!a || (a.type !== undefined && a.type !== "choice") || typeof a.probabilities !== "object") {
    throw new Error(`expected a choice answer for "${id}", got ${JSON.stringify(a)?.slice(0, 200)}`);
  }
  return a as ChoiceAnswer;
}

export function noulAnswer(res: JevResponse, id: string): NoulAnswer {
  const a = res.answers[id] as Partial<NoulAnswer> | undefined;
  if (!a || (a.type !== undefined && a.type !== "noul") || typeof a.noul !== "number") {
    throw new Error(`expected a noul answer for "${id}", got ${JSON.stringify(a)?.slice(0, 200)}`);
  }
  return a as NoulAnswer;
}
