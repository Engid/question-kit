// checkClaim: does a source back up a claim?
//
// Code does what code can: if the claim comes with a quote, the quote must appear in the source
// (after evening out whitespace and curly quotes), or the claim is marked fabricated without asking
// Jev. Then one Choice asks how the section relates to the claim: supports it, contradicts it, or
// says nothing about it. Below `autoAbove`, a person should confirm.
// Based on the approach in TypeSafe's "Double-checking citations" cookbook.

import { choice } from "../questions.ts";
import { readChoice } from "../readings.ts";
import { type Task } from "../task.ts";

export interface CheckClaimOptions {
  /** A quote the claim cites; it must be found in the source. */
  quote?: string;
  /** Which section to check when there's no quote (a key of `sections`). */
  section?: string;
  /** Accept the verdict without a person at or above this confidence. Default 0.8. */
  autoAbove?: number;
}

export type Verdict = "verified" | "contradicted" | "unsupported" | "fabricated";

export interface CheckedClaim {
  verdict: Verdict;
  /** Which section the claim was checked against. */
  section: string | null;
  confidence: number;
  /** True when the verdict can stand without a person. */
  auto: boolean;
}

/** Even out whitespace and quote marks, so a quote still matches across line breaks. */
export function normalizeQuote(s: string): string {
  return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();
}

/** Check a claim against a source given as one text or as named sections. */
export function checkClaim(claim: string, source: string | Record<string, string>, opts: CheckClaimOptions = {}): Task<CheckedClaim> {
  const sections = typeof source === "string" ? { source } : source;
  let section: string | null = opts.section ?? null;
  if (opts.quote) {
    const needle = normalizeQuote(opts.quote);
    section = Object.keys(sections).find((k) => normalizeQuote(sections[k]!).includes(needle)) ?? null;
    if (section === null) return { parts: {}, questions: () => ({}), read: () => ({ verdict: "fabricated", section: null, confidence: 1, auto: true }) };
  }
  section ??= Object.keys(sections)[0] ?? null;
  if (section === null || !(section in sections)) throw new Error(`no section "${section}" to check against`);
  const text = sections[section]!;
  return {
    parts: { claim, section: text },
    questions: (at) => ({
      relation: choice(`How does ${at("section")} relate to ${at("claim")}?`, {
        supports: "The section states the claim, or clearly implies it's true.",
        contradicts: "The section states the opposite, or clearly implies the claim is false.",
        says_nothing: "The section doesn't address what the claim says, either way.",
      }),
    }),
    read: (a) => {
      const r = readChoice<"supports" | "contradicts" | "says_nothing">(a.relation);
      const verdict: Verdict = r.value === "supports" ? "verified" : r.value === "contradicts" ? "contradicted" : "unsupported";
      return { verdict, section, confidence: r.confidence, auto: r.confidence >= (opts.autoAbove ?? 0.8) };
    },
  };
}
