import { choiceConfidence } from "./confidence.ts";
import type { Answer, ChoiceAnswer, JevClient, JevRequest, JevResponse, NoulAnswer, Question } from "./types.ts";

export type MockAnswerer = (id: string, question: Question, request: JevRequest) => Answer | undefined;

/**
 * A client for tests. `answer` is called once per question; return undefined to fall back to a
 * uniform answer (every Choice option equally likely, every Noul at 0.5).
 */
export class MockJevClient implements JevClient {
  readonly name = "mock";
  calls: JevRequest[] = [];

  constructor(private readonly answer: MockAnswerer = () => undefined) {}

  async systemOne(request: JevRequest): Promise<JevResponse> {
    this.calls.push(request);
    const answers: Record<string, Answer> = {};
    for (const [id, q] of Object.entries(request.questions)) {
      answers[id] = this.answer(id, q, request) ?? uniformAnswer(q);
    }
    return { model: "mock", answers, usage: { input_tokens: 0, output_tokens: 0 } };
  }
}

export function uniformAnswer(q: Question): Answer {
  if (q.type === "noul") return { type: "noul", noul: 0.5 };
  if (q.type === "choice") return peakedChoice(Object.keys(q.criteria), undefined, 0);
  const n = q.criteria.length;
  const probabilities: Record<string, number> = {};
  for (let i = 0; i < n; i++) probabilities[String(i)] = 1 / n;
  return { type: "score", score: (n - 1) / 2, confidence: 0, probabilities };
}

/**
 * A Choice answer that puts `mass` on `pick` and spreads the rest evenly. With no pick, or mass 0,
 * the answer is uniform and its `choice` is the first option.
 */
export function peakedChoice(options: string[], pick: string | undefined, mass: number): ChoiceAnswer {
  const n = options.length;
  const probabilities: Record<string, number> = {};
  const hasPick = pick !== undefined && options.includes(pick) && mass > 0;
  const rest = hasPick ? (1 - mass) / Math.max(n - 1, 1) : 1 / n;
  for (const o of options) probabilities[o] = hasPick && o === pick ? (n === 1 ? 1 : mass) : rest;
  const choice = hasPick ? (pick as string) : (options[0] ?? "");
  return { type: "choice", choice, confidence: choiceConfidence(probabilities), probabilities };
}

export function noul(p: number): NoulAnswer {
  return { type: "noul", noul: p };
}
