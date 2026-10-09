// verifyRecord: is anything wrong with a record extracted from a text?
//
// For each filled field, several narrow yes/no checks against the source, each phrased so that yes
// means "wrong": it doesn't fit the field, isn't supported by the text, comes from text that isn't
// really about this field, misses part of what the text gives, or breaks the field's format. For
// each empty field, whether the text actually gives a value. The record is flagged when any one
// check is confident, so a single clear problem isn't averaged away by passing checks.
// Date fields are different: a yes/no question reads "October 9" against 2026-10-09 too literally
// (the text has no year), so the source's date is read with extractDate and compared in code.
// Use it to check any extraction: from an LLM, a form parser, or another question-kit method.
// Based on the approach in TypeSafe's "SDE cascade" cookbook.

import type { Json, Question } from "../system-one.ts";
import { noul } from "../questions.ts";
import { readNoul } from "../readings.ts";
import { Ref, type Text } from "../state.ts";
import { nest, place, type Task } from "../task.ts";
import { type DateExpectation, type ExtractedDate, extractDate } from "./extract-date.ts";

export interface FieldSpec {
  /** What the field holds. */
  description: string;
  /** Expected type or format, in words: "a date as YYYY-MM-DD", "a 10-digit number". */
  format?: string;
  /**
   * The field is a calendar date, stored as YYYY-MM-DD. It's checked by reading the source's date
   * with extractDate and comparing in code, not with yes/no questions. The value says where the date
   * is expected to fall when the source gives no year ("past", "future" or "nearest"); true means
   * "nearest". Needs `today` in the options.
   */
  date?: boolean | DateExpectation;
}

export type Check = "mismatch" | "unsupported" | "off_target" | "incomplete" | "format" | "missing" | "date";

export interface VerifyOptions {
  /** Flag the record when any check's probability is above this. Default 0.7. */
  flagAbove?: number;
  /** Today's date, as YYYY-MM-DD. Needed for date fields. */
  today?: string;
  name?: string;
}

export interface DateCheck {
  /** The date the source gives for the field, or null when it gives none. */
  found: string | null;
  /** Whether the record's value is that date (month and day only, when the source gives no year). */
  matches: boolean;
  /** The source gives the date without a year, so `found` uses the year the field expects. */
  yearGuessed: boolean;
  /** How sure the reading of the source's date is. */
  confidence: number;
}

export interface Verified {
  /** True when no check is above the threshold. */
  ok: boolean;
  /** Checks above the threshold, worst first. */
  flagged: { field: string; check: Check; probability: number }[];
  /** The single worst check. */
  worst: { field: string; check: Check; probability: number } | null;
  /**
   * Probability that each field is wrong (its worst check). For a date field it comes from the
   * comparison: the reading's confidence when the dates differ, one minus it when they agree.
   */
  fields: Record<string, number>;
  /** Date fields: the date the source gives, and whether the record agrees. */
  dates: Record<string, DateCheck>;
  /** Fields a person should look at even when nothing is flagged, and why. */
  review: { field: string; note: string }[];
}

const CHECKS: Record<Exclude<Check, "missing" | "format" | "date">, { question: string; true: string; false: string }> = {
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

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The role extractDate looks for: the description if it reads as one ("the date …"), else built from the field's name. */
function dateRole(field: string, spec: FieldSpec): string {
  if (/^the\b/i.test(spec.description)) return spec.description;
  const name = field.replace(/_/g, " ");
  return `the ${/\bdate\b/i.test(name) ? name : `${name} date`} (${spec.description})`;
}

function isDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export function verifyRecord(source: Text, schema: Record<string, FieldSpec>, record: Record<string, Json>, opts: VerifyOptions = {}): Task<Verified> {
  const t = place(source, opts.name ?? "source");
  const asked: [string, Check][] = [];
  const dateFields: string[] = [];
  for (const [field, spec] of Object.entries(schema)) {
    const v = record[field];
    const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    if (spec.date) {
      if (!opts.today) throw new Error(`verifyRecord: "${field}" is a date field, so pass \`today\` (YYYY-MM-DD)`);
      dateFields.push(field);
    } else if (empty) asked.push([field, "missing"]);
    else {
      for (const c of Object.keys(CHECKS) as Check[]) asked.push([field, c]);
      if (spec.format) asked.push([field, "format"]);
    }
  }
  const dateTask = (field: string, r: Ref): Task<ExtractedDate> => {
    const spec = schema[field]!;
    return nest(`${field}.date`, extractDate(r, { role: dateRole(field, spec), today: opts.today!, expect: spec.date === true ? "nearest" : (spec.date as DateExpectation) }));
  };
  return {
    parts: t.parts,
    questions: (at) => {
      const qs: Record<string, Question> = {};
      for (const field of dateFields) Object.assign(qs, dateTask(field, t.ref(at)).questions(at));
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
          const spec2 = CHECKS[c as keyof typeof CHECKS];
          qs[`${field}.${c}`] = noul({ field: fieldJson, value: record[field]!, question: spec2.question.replace("the `source`", String(t.ref(at))) }, { true: spec2.true, false: spec2.false });
        }
      }
      return qs;
    },
    read: (a) => {
      const threshold = opts.flagAbove ?? 0.7;
      const all: { field: string; check: Check; probability: number }[] = asked.map(([field, check]) => ({ field, check, probability: readNoul(a[`${field}.${check}`]).probability }));
      const dates: Record<string, DateCheck> = {};
      const review: { field: string; note: string }[] = [];
      for (const field of dateFields) {
        const got = dateTask(field, new Ref("source")).read(a);
        const v = record[field];
        const empty = v === undefined || v === null || v === "";
        const unread = got.date === null && got.parts.mode !== "none";
        if (unread) review.push({ field, note: `couldn't read the date in the source (${got.note ?? "unclear"})` });
        else if (got.review) review.push({ field, note: "the date in the source was read without confidence" });
        if (empty) {
          // Empty is wrong when the source gives a date.
          dates[field] = { found: got.date, matches: got.date === null, yearGuessed: got.yearGuessed, confidence: got.confidence };
          all.push({ field, check: "missing", probability: unread ? 0.5 : got.date !== null ? got.confidence : 1 - got.confidence });
          continue;
        }
        if (typeof v !== "string" || !isDate(v)) {
          dates[field] = { found: got.date, matches: false, yearGuessed: got.yearGuessed, confidence: got.confidence };
          all.push({ field, check: "format", probability: 1 });
          continue;
        }
        const matches = got.date !== null && (got.yearGuessed ? v.slice(5) === got.date.slice(5) : v === got.date);
        dates[field] = { found: got.date, matches, yearGuessed: got.yearGuessed, confidence: got.confidence };
        const probability = unread ? 0.5 : matches ? 1 - got.confidence : got.confidence;
        all.push({ field, check: "date", probability });
        if (!matches && !unread && probability <= threshold) review.push({ field, note: `the source seems to give ${got.date ?? "no date"}, but the reading isn't sure enough to flag it` });
        if (matches && got.yearGuessed && v.slice(0, 4) !== got.date!.slice(0, 4)) review.push({ field, note: `the source gives no year; the record says ${v.slice(0, 4)}, the expected year is ${got.date!.slice(0, 4)}` });
      }
      all.sort((x, y) => y.probability - x.probability);
      const flagged = all.filter((c) => c.probability > threshold);
      const fields: Record<string, number> = {};
      for (const c of all) fields[c.field] = Math.max(fields[c.field] ?? 0, c.probability);
      return { ok: flagged.length === 0, flagged, worst: all[0] ?? null, fields, dates, review };
    },
  };
}
