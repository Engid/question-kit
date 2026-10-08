// extractValue: an exact value from the text, picked from candidates code found.
//
// Code finds every candidate (a pattern tuned to over-find, a list of known names, or values you
// pass), Jev picks the one in the role you describe or "none", and code copies the picked text and
// normalizes it. Jev only ever chooses among spans that are really there, so a value can't be
// invented or have a digit swapped.
// Based on the approach in TypeSafe's "Pre-parsed value extraction" cookbook.

import { MAX_CHOICE_OPTIONS, type Question } from "../jev.ts";
import { choice } from "../questions.ts";
import { readChoice } from "../readings.ts";
import { q, type Text } from "../state.ts";
import { place, type Task } from "../task.ts";

/** Patterns that over-find on purpose: Jev decides which match is the one asked for. */
export const PATTERNS = {
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  phone: /\+?\(?\d[\d\s().-]{6,}\d/g,
  amount: /[$€£¥]\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s?(?:dollars|usd|eur|euros|gbp|pounds)\b/gi,
  /** Runs of 5 or more digits, optionally with dashes or spaces inside (order, account, tracking numbers). */
  number: /\b[A-Z]{0,4}\d[\d -]{3,}\d\b/g,
  zip: /\b\d{5}(?:-\d{4})?\b/g,
} as const;

export type ValueKind = keyof typeof PATTERNS | RegExp | { names: string[] } | { candidates: string[] };

export interface ExtractValueOptions {
  /** What to look for: a built-in pattern, your own RegExp (use the g flag), known names, or fixed candidates. */
  kind: ValueKind;
  /** The role of the value, written as a noun phrase: "the order number", "the email to send the receipt to". */
  role: string;
  /** Turn the picked text into the value you store. Defaults by kind (lowercase emails, digits-only numbers…). */
  normalize?: (raw: string) => string;
  /** Default country code for phone numbers without one. Default "1". */
  countryCode?: string;
  name?: string;
}

export interface ExtractedValue {
  /** The normalized value, or null when the text doesn't give one. */
  value: string | null;
  /** The text exactly as it appears. */
  raw: string | null;
  probability: number;
  confidence: number;
  candidates: string[];
}

/** Every candidate in the text for a kind, in order of appearance, without duplicates. */
export function findCandidates(text: string, kind: ValueKind): string[] {
  let found: string[];
  if (typeof kind === "object" && !(kind instanceof RegExp)) {
    // Every name is offered: the text may use a nickname or a first name that no simple match
    // would find ("dave" for "David Minh"), and Jev can still answer "none".
    found = "candidates" in kind ? kind.candidates : kind.names;
  } else {
    const re = kind instanceof RegExp ? kind : PATTERNS[kind];
    const global = re.global ? re : new RegExp(re.source, `${re.flags}g`);
    found = [...text.matchAll(global)].map((m) => m[0]);
  }
  const seen = new Set<string>();
  return found.map((s) => s.trim().replace(/[.,;:]+$/, "")).filter((s) => s && !seen.has(s) && (seen.add(s), true));
}

export function normalizeValue(raw: string, kind: ValueKind, countryCode = "1"): string {
  if (kind === "email") return raw.toLowerCase();
  if (kind === "phone") {
    const plus = raw.trim().startsWith("+");
    const digits = raw.replace(/\D/g, "");
    if (plus) return `+${digits}`;
    if (countryCode === "1" && digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    return `+${countryCode}${digits}`;
  }
  if (kind === "amount") {
    const n = raw.replace(/[^\d.]/g, "");
    return n;
  }
  if (kind === "number" || kind === "zip") return raw.replace(/[\s-]/g, "");
  return raw.trim();
}

export function extractValue(text: string, opts: ExtractValueOptions): Task<ExtractedValue>;
export function extractValue(text: Text, opts: ExtractValueOptions & { source: string }): Task<ExtractedValue>;
export function extractValue(text: Text, opts: ExtractValueOptions & { source?: string }): Task<ExtractedValue> {
  const source = typeof text === "string" ? text : opts.source;
  if (source === undefined) throw new Error("extractValue needs the text itself (pass `source` when giving a Ref)");
  const candidates = findCandidates(source, opts.kind);
  if (candidates.length > MAX_CHOICE_OPTIONS - 1) throw new Error(`${candidates.length} candidates is more than one Choice holds; narrow the text first`);
  const t = place(text, opts.name ?? "text");
  const none = "none";
  const keyFor = (c: string) => (c === none ? `${c} (as written)` : c);
  const normalize = opts.normalize ?? ((raw: string) => normalizeValue(raw, opts.kind, opts.countryCode));
  // Names and fixed candidates come from a list, not from the text, so the text may refer to them
  // in a shorter form ("crystal" for "Crystal Minh"); patterns match the text exactly.
  const fromList = typeof opts.kind === "object" && !(opts.kind instanceof RegExp);
  return {
    parts: candidates.length ? t.parts : {},
    questions: (at): Record<string, Question> =>
      candidates.length
        ? {
            value: choice(
              fromList
                ? q`Which of these is ${opts.role}, going by ${t.ref(at)}? It counts if the text refers to it in a shorter or different form, like a first name. Choose "none" if it's none of them.`
                : q`Which of these is ${opts.role}, as given in ${t.ref(at)}? Choose "none" if it doesn't give ${opts.role}.`,
              Object.fromEntries(candidates.map((c) => [keyFor(c), null])),
              { none: `None of these is ${opts.role}.` },
            ),
          }
        : {},
    read: (a) => {
      if (!candidates.length) return { value: null, raw: null, probability: 1, confidence: 1, candidates };
      const r = readChoice(a.value);
      if (r.value === none) return { value: null, raw: null, probability: r.probability, confidence: r.confidence, candidates };
      const raw = candidates.find((c) => keyFor(c) === r.value) ?? r.value;
      return { value: normalize(raw), raw, probability: r.probability, confidence: r.confidence, candidates };
    },
  };
}
