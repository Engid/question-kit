// stability: ask the same questions several times and see how much the answers move.
//
// Each repeat adds a different id to the state (repeat-1, repeat-2…), so each is a separate request
// that a cache can still replay later. It reports, per question, the mean, spread and range of the
// answer, and whether a probability ever crossed 0.5. Use it with `band` (an "uncertain" middle that goes to a person) to see which
// questions sit too close to the line to act on.
// Based on the approach in TypeSafe's "Self-consistency" cookbooks (nouls and choices).

import type { Answer, SystemOneCall, SystemOneClient, Json } from "../system-one.ts";
import { send } from "../system-one.ts";
import { requestAll, type Task } from "../task.ts";

export interface QuestionStability {
  mean: number;
  spread: number;
  min: number;
  max: number;
  /** True when the answer landed on both sides of 0.5. */
  crosses: boolean;
}

/** The number tracked per answer: a Noul's probability, a Choice's top probability, a Score's value. */
function tracked(a: Answer): number {
  if ("noul" in a) return a.noul;
  if ("score" in a) return a.score;
  return Math.max(...Object.values(a.probabilities));
}

export async function stability(client: SystemOneClient, tasks: Record<string, Task<unknown>>, repeats = 5, opts: { state?: Record<string, Json>; log?: SystemOneCall[] } = {}): Promise<Record<string, QuestionStability>> {
  const { state, questions } = requestAll(tasks, opts);
  const seen: Record<string, number[]> = {};
  for (let i = 0; i < repeats; i++) {
    const answers = await send(client, { ...(state as Record<string, Json>), uid: `repeat-${i + 1}` }, questions, { log: opts.log, title: `stability: repeat ${i + 1}` });
    for (const [id, a] of Object.entries(answers)) (seen[id] ??= []).push(tracked(a));
  }
  return Object.fromEntries(
    Object.entries(seen).map(([id, xs]) => {
      const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
      const spread = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
      return [id, { mean, spread, min: Math.min(...xs), max: Math.max(...xs), crosses: xs.some((x) => x > 0.5) && xs.some((x) => x <= 0.5) }];
    }),
  );
}
