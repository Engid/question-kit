// classify: which label fits, and the broader label when the model isn't sure.
//
// One Choice over the labels, with a "none" option when the list may not cover the input. If a
// label has a parent and the answer's confidence is under `backoffBelow`, the result is the parent:
// a broad answer you can trust instead of a narrow one you can't, with no second request.
// Based on the approach in TypeSafe's "Classification using confidence" cookbook.

import { choice, NONE, type Option, type OptionSpec } from "../questions.ts";
import { type ChoiceReading, readChoice } from "../readings.ts";
import { q, type Text } from "../state.ts";
import { place, type Task } from "../task.ts";

export type Label = string | (OptionSpec & { parent?: string });

export interface ClassifyOptions {
  /** The question, written about the text. Default: "Which of these best describes `text`?" */
  question?: string;
  /** Description of the "none" option, or false for none. Default: "None of these fit." */
  none?: string | false;
  /** Report the parent label when confidence is under this (only for labels with a parent). */
  backoffBelow?: number;
  name?: string;
}

export interface Classified<K extends string> extends ChoiceReading<K | typeof NONE> {
  /** The parent label, when the answer backed off to it. */
  parent?: string;
  /** "label" for the label itself, "parent" when it backed off. */
  level: "label" | "parent";
}

export function classify<K extends string>(text: Text, labels: Record<K, Label>, opts: ClassifyOptions = {}): Task<Classified<K>> {
  const t = place(text, opts.name ?? "text");
  const none = opts.none === undefined ? "None of these fit." : opts.none;
  const options: Record<string, Option> = {};
  for (const [id, l] of Object.entries(labels) as [K, Label][]) {
    if (typeof l === "string") options[id] = l;
    else {
      const { parent: _parent, ...spec } = l;
      options[id] = spec;
    }
  }
  return {
    parts: t.parts,
    questions: (at) => {
      const r = t.ref(at);
      return { label: choice(opts.question ? q`About ${r}: ${opts.question}` : q`Which of these best describes ${r}?`, options, { none }) };
    },
    read: (a) => {
      const r = readChoice<K | typeof NONE>(a.label);
      const label = r.value === NONE ? undefined : labels[r.value as K];
      const parent = label && typeof label === "object" ? label.parent : undefined;
      if (parent && opts.backoffBelow !== undefined && r.confidence < opts.backoffBelow) return { ...r, parent, level: "parent" };
      return { ...r, level: "label" };
    },
  };
}
