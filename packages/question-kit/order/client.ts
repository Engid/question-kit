// What the order taker needs from a System One client: send one batch of questions about one state
// and get the answers back. The wire types and `send` come from question-kit; this adds the `meta`
// bookkeeping (what each question is about, for logs and explaining an order) and two readers.

import { type Answer, type Entry, type Question, send, type SystemOneCall, type SystemOneClient } from "../core/index.ts";

/** A question plus what it is about (kept in the request's `meta`, never sent to the API). */
export interface Asked {
  question: Question;
  about: Record<string, unknown>;
}

/**
 * Ask every question about `state` in one request (question-kit's `send` splits it into several if
 * it would be too big) and return all the answers. Each request made is pushed onto `log`.
 */
export async function ask(client: SystemOneClient, log: SystemOneCall[], title: string, state: Entry, asked: Record<string, Asked>): Promise<Record<string, Answer>> {
  const questions = Object.fromEntries(Object.entries(asked).map(([id, a]) => [id, a.question]));
  const meta = Object.fromEntries(Object.entries(asked).map(([id, a]) => [id, a.about]));
  return send(client, state, questions, { log, title, meta });
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
