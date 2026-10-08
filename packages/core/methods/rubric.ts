// rubric and featurize: many questions about one text, in one request.
//
// rubric asks a mixed set of questions (statements, choices, scales) about one text at once:
// Jev answers each independently, so one request with N questions gives the same answers as N
// requests, for a fraction of the cost and time.
// Based on the approach in TypeSafe's "Parallel questions" cookbook.
//
// featurize turns a rubric's answers into numbers for a predictive model: a statement becomes its
// probability, a scale becomes its expected level and the spread around it.
// Based on the approach in TypeSafe's "Autoresearch feature discovery" cookbook (its question-
// proposing loop, which needs an LLM, isn't included).

import type { Entry, JevCall, JevClient } from "../jev.ts";
import { choice, noul, type Option, score } from "../questions.ts";
import { type ChoiceReading, type NoulReading, readChoice, readNoul, readScore, type ScoreReading } from "../readings.ts";
import { q, type Text } from "../state.ts";
import { place, run, type Task } from "../task.ts";

export type RubricItem =
  | { statement: string; true?: Entry; false?: Entry }
  | { choose: string; options: Record<string, Option> }
  | { rate: string; levels: Entry[] };

export type RubricReading<I> = I extends { statement: string } ? NoulReading : I extends { choose: string } ? ChoiceReading : ScoreReading;

export function rubric<R extends Record<string, RubricItem>>(text: Text, items: R, opts: { name?: string } = {}): Task<{ [K in keyof R]: RubricReading<R[K]> }> {
  const t = place(text, opts.name ?? "text");
  return {
    parts: t.parts,
    questions: (at) => {
      const r = t.ref(at);
      return Object.fromEntries(
        Object.entries(items).map(([id, it]) => {
          if ("statement" in it) return [id, noul(q`About ${r}: ${it.statement}`, it.true || it.false ? { true: it.true, false: it.false } : undefined)];
          if ("choose" in it) return [id, choice(q`About ${r}: ${it.choose}`, it.options)];
          return [id, score(q`About ${r}: ${it.rate}`, it.levels)];
        }),
      );
    },
    read: (a) =>
      Object.fromEntries(
        Object.entries(items).map(([id, it]) => [id, "statement" in it ? readNoul(a[id]) : "choose" in it ? readChoice(a[id]) : readScore(a[id])]),
      ) as { [K in keyof R]: RubricReading<R[K]> },
  };
}

/** Numeric features for each text: statement → probability; scale → expected level and spread; choice → one probability per option. */
export async function featurize(jev: JevClient, texts: string[], items: Record<string, RubricItem>, opts: { concurrency?: number; log?: JevCall[] } = {}): Promise<Record<string, number>[]> {
  const one = async (text: string) => {
    const r = await run(jev, rubric(text, items), { log: opts.log, title: "featurize" });
    const row: Record<string, number> = {};
    for (const [id, reading] of Object.entries(r) as [string, NoulReading | ChoiceReading | ScoreReading][]) {
      if ("level" in reading) {
        const mean = reading.value;
        const sd = Math.sqrt(reading.probabilities.reduce((s, p, i) => s + p * (i - mean) ** 2, 0));
        row[`${id}.mean`] = mean;
        row[`${id}.spread`] = sd;
      } else if ("ranked" in reading) {
        for (const [opt, p] of Object.entries(reading.probabilities)) row[`${id}.${opt}`] = p;
      } else row[id] = reading.probability;
    }
    return row;
  };
  const out: Record<string, number>[] = [];
  const limit = Math.max(1, opts.concurrency ?? 8);
  for (let i = 0; i < texts.length; i += limit) out.push(...(await Promise.all(texts.slice(i, i + limit).map(one))));
  return out;
}
