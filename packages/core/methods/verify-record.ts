// verifyRecord: is anything wrong with a record extracted from a text?
//
// For each filled field, several narrow yes/no checks against the source, each phrased so that yes
// means "wrong": it doesn't fit the field, isn't supported by the text, comes from text that isn't
// really about this field, misses part of what the text gives, or breaks the field's format. For
// each empty field, whether the text actually gives a value. The record is flagged when any one
// check is confident, so a single clear problem isn't averaged away by passing checks.
// Use it to check any extraction: from an LLM, a form parser, or another question-kit method.
// Based on the approach in TypeSafe's "SDE cascade" cookbook.

import type { Json } from "../jev.ts";
import { noul } from "../questions.ts";
import { readNoul } from "../readings.ts";
import type { Text } from "../state.ts";
import { place, type Task } from "../task.ts";

export interface FieldSpec {
  /** What the field holds. */
  description: string;
  /** Expected type or format, in words: "a date as YYYY-MM-DD", "a 10-digit number". */
  format?: string;
}

export type Check = "mismatch" | "unsupported" | "off_target" | "incomplete" | "format" | "missing";

export interface VerifyOptions {
  /** Flag the record when any check's probability is above this. Default 0.7. */
  flagAbove?: number;
  name?: string;
}

export interface Verified {
  /** True when no check is above the threshold. */
  ok: boolean;
  /** Checks above the threshold, worst first. */
  flagged: { field: string; check: Check; probability: number }[];
  /** The single worst check. */
  worst: { field: string; check: Check; probability: number } | null;
  /** Probability that each field is wrong (its worst check). */
  fields: Record<string, number>;
}

const CHECKS: Record<Exclude<Check, "missing" | "format">, { question: string; true: string; false: string }> = {
  mismatch: {
    question: "Is the `value` the wrong kind of thing for the `field` described?",
    true: "The value doesn't fit what the field is for.",
    false: "The value is the kind of thing the field is for.",
  },
  unsupported: {
    question: "Is the `value` absent from, or unsupported by, the `source`? A value the source gives in another form (a date, number or name written another way) counts as supported.",
    true: "The source doesn't give this value; it was made up or changed.",
    false: "The source gives this value, possibly written another way (\"October 9\" for 2026-10-09).",
  },
  off_target: {
    question: "Does the `value` come from a part of the `source` about something other than this `field`?",
    true: "The value was taken from incidental text, not from what the source says about this field.",
    false: "The source really gives this value for this field.",
  },
  incomplete: {
    question: "Is the `value` cut short, so that it misses information the `field` asks for and the `source` gives? Extra detail beyond what the field asks for can be left out.",
    true: "The value is partial: part of what the field asks for is missing (a number with digits cut off, half of a name).",
    false: "The value has what the field asks for; any detail left out isn't part of the field.",
  },
};

export function verifyRecord(source: Text, schema: Record<string, FieldSpec>, record: Record<string, Json>, opts: VerifyOptions = {}): Task<Verified> {
  const t = place(source, opts.name ?? "source");
  const asked: [string, Check][] = [];
  for (const [field, spec] of Object.entries(schema)) {
    const v = record[field];
    const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    if (empty) asked.push([field, "missing"]);
    else {
      for (const c of Object.keys(CHECKS) as Check[]) asked.push([field, c]);
      if (spec.format) asked.push([field, "format"]);
    }
  }
  return {
    parts: t.parts,
    questions: (at) => {
      const qs: Record<string, ReturnType<typeof noul>> = {};
      for (const [field, c] of asked) {
        const spec = schema[field]!;
        const fieldJson = { name: field, description: spec.description, ...(spec.format ? { format: spec.format } : {}) };
        if (c === "missing") {
          qs[`${field}.missing`] = noul(
            { field: fieldJson, value: null, question: `The record leaves the \`field\` empty. Does ${t.ref(at)} give a value for it?` },
            { true: "The source gives a value for this field, so leaving it empty is wrong.", false: "The source gives no value for this field." },
          );
        } else if (c === "format") {
          qs[`${field}.format`] = noul(
            { field: fieldJson, value: record[field]!, question: "Does the `value` break the `field`'s format?" },
            { true: "The value isn't in the required format.", false: "The value is in the required format." },
          );
        } else {
          const spec2 = CHECKS[c];
          qs[`${field}.${c}`] = noul({ field: fieldJson, value: record[field]!, question: spec2.question.replace("the `source`", String(t.ref(at))) }, { true: spec2.true, false: spec2.false });
        }
      }
      return qs;
    },
    read: (a) => {
      const all = asked.map(([field, check]) => ({ field, check, probability: readNoul(a[`${field}.${check}`]).probability }));
      all.sort((x, y) => y.probability - x.probability);
      const threshold = opts.flagAbove ?? 0.7;
      const flagged = all.filter((c) => c.probability > threshold);
      const fields: Record<string, number> = {};
      for (const c of all) fields[c.field] = Math.max(fields[c.field] ?? 0, c.probability);
      return { ok: flagged.length === 0, flagged, worst: all[0] ?? null, fields };
    },
  };
}
