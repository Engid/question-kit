// One-question tasks: check a statement, choose an option, rate on a scale.
//
// These are the building blocks the other methods use. Each takes the text it's about (or a Ref to
// it) and writes the question so it points at that part of the state: "About `text`: <statement>".
// To write the whole question yourself, pass a function of the Ref instead of a string; it gets
// the path the text ended up at, so the wording and the state can't drift apart.

import type { Entry } from "./system-one.ts";
import { choice, NONE, noul, type Option, score } from "./questions.ts";
import { type ChoiceReading, type NoulReading, readChoice, readNoul, readScore, type ScoreReading } from "./readings.ts";
import { q, type Ref, type Text } from "./state.ts";
import { place, type Task } from "./task.ts";

/** Question text: a statement to put after "About `text`:", or the whole question as a function of the text's Ref. */
export type Wording = string | ((text: Ref) => string);

/** The instructions for a question about `text`: the wording as given, or "About `text`: <wording>". */
export function about(text: Ref, wording: Wording): string {
  return typeof wording === "function" ? wording(text) : q`About ${text}: ${wording}`;
}

/**
 * Is a statement about the text true? Write the statement so that true is the thing you're looking
 * for: "The customer asks to speak to a person."
 */
export function check(text: Text, statement: Wording, criteria?: { true?: Entry; false?: Entry }, opts: { name?: string } = {}): Task<NoulReading> {
  const t = place(text, opts.name ?? "text");
  return {
    parts: t.parts,
    questions: (at) => ({ check: noul(about(t.ref(at), statement), criteria) }),
    read: (a) => readNoul(a.check),
  };
}

/** Several statements about the same text, one Noul each, in one request. */
export function checks<K extends string>(text: Text, statements: Record<K, Wording | { statement: Wording; true?: Entry; false?: Entry }>, opts: { name?: string } = {}): Task<Record<K, NoulReading>> {
  const t = place(text, opts.name ?? "text");
  return {
    parts: t.parts,
    questions: (at) =>
      Object.fromEntries(
        (Object.entries(statements) as [K, Wording | { statement: Wording; true?: Entry; false?: Entry }][]).map(([id, s]) => {
          const spec = typeof s === "object" ? s : { statement: s };
          return [id, noul(about(t.ref(at), spec.statement), spec.true || spec.false ? { true: spec.true, false: spec.false } : undefined)];
        }),
      ),
    read: (a) => Object.fromEntries(Object.keys(statements).map((id) => [id, readNoul(a[id])])) as Record<K, NoulReading>,
  };
}

export interface ChooseOptions {
  /** The question: a statement after "About `text`:", or the whole question as a function of the Ref. Default: "Which of these best fits `text`?" */
  question?: Wording;
  /** Add a "none" option with this description. Default: "None of these fit." Pass false to leave it out. */
  none?: string | false;
  name?: string;
}

/** Which one option fits the text? */
export function choose<K extends string>(text: Text, options: Record<K, Option>, opts: ChooseOptions = {}): Task<ChoiceReading<K | typeof NONE>> {
  const t = place(text, opts.name ?? "text");
  const none = opts.none === undefined ? "None of these fit." : opts.none;
  return {
    parts: t.parts,
    questions: (at) => {
      const r = t.ref(at);
      const instructions = opts.question ? about(r, opts.question) : q`Which of these best fits ${r}?`;
      return { choice: choice(instructions, options, { none }) };
    },
    read: (a) => readChoice<K | typeof NONE>(a.choice),
  };
}

/** Where does the text fall on ordered levels (lowest first)? */
export function rate(text: Text, question: Wording, levels: Entry[], opts: { name?: string } = {}): Task<ScoreReading> {
  const t = place(text, opts.name ?? "text");
  return {
    parts: t.parts,
    questions: (at) => ({ score: score(about(t.ref(at), question), levels) }),
    read: (a) => readScore(a.score),
  };
}
