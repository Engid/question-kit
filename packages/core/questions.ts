// Building questions.
//
// The three kinds are TypeSafe's: a Choice picks one option, a Noul says how likely a statement is
// true, and a Score places the state on ordered levels (https://docs.typesafe.ai/primitives.md).
// These helpers add what the docs recommend: a "none" option where the list may not cover the input,
// and structured option descriptions (`what`, `not_for`, `examples`) for options that look alike
// (https://docs.typesafe.ai/primitives/advanced.md).

import type { ChoiceQuestion, Entry, Json, NoulQuestion, ScoreQuestion } from "./jev.ts";

/** The id of the "none of these" option that methods add. */
export const NONE = "none";

/** An option: plain text, a structured description, or any JSON object describing it. */
export type Option = string | null | OptionSpec | { [key: string]: Json };

export interface OptionSpec {
  /** What the option covers. */
  what: string;
  /** What it doesn't cover, to separate it from look-alikes. */
  not_for?: string;
  /** Short examples of inputs that belong here. */
  examples?: string[];
}

export function describe(option: Option): Entry {
  if (option === null || typeof option === "string") return option;
  if (typeof option.what !== "string") return option as { [key: string]: Json };
  const spec = option as OptionSpec;
  const out: Record<string, Json> = { what: spec.what };
  if (spec.not_for) out.not_for = spec.not_for;
  if (spec.examples?.length) out.examples = spec.examples;
  for (const [k, v] of Object.entries(option)) if (!(k in out) && k !== "not_for" && k !== "examples" && v !== undefined) out[k] = v as Json;
  return out;
}

export interface ChoiceOptions {
  /** Add a "none" option with this description, or false for none. Default: no "none" option. */
  none?: string | false;
}

export function choice(instructions: Entry, options: Record<string, Option>, opts: ChoiceOptions = {}): ChoiceQuestion {
  const criteria: Record<string, Entry> = {};
  for (const [id, o] of Object.entries(options)) criteria[id] = describe(o);
  if (opts.none) {
    if (NONE in criteria) throw new Error(`an option is already called "${NONE}"`);
    criteria[NONE] = opts.none;
  }
  return { type: "choice", instructions, criteria };
}

/** A statement that's either true or false. Phrase it so that true means the thing you're looking for. */
export function noul(instructions: Entry, criteria?: { true?: Entry; false?: Entry }): NoulQuestion {
  return { type: "noul", instructions, ...(criteria ? { criteria } : {}) };
}

/** Ordered levels, lowest first. */
export function score(instructions: Entry, levels: Entry[]): ScoreQuestion {
  return { type: "score", instructions, criteria: levels };
}
