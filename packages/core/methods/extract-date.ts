// extractDate: a calendar date the text gives in a role you name.
//
// Jev never does calendar arithmetic. It answers Choice questions about the date's parts (written
// as a date or relative to today; month; day; year; which day it's anchored to; weekday; which
// week), and code turns the parts into a date against a fixed "today". The date's confidence is its
// least sure part; low ones, or parts that don't make a date, are flagged for review.
// Based on the approach in TypeSafe's "Date extraction" cookbook, extended with past references
// ("yesterday", "last week"), which customer messages use a lot.

import { choice } from "../questions.ts";
import { type ChoiceReading, lowest, readChoice } from "../readings.ts";
import { q, type Text } from "../state.ts";
import { place, type Task } from "../task.ts";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export interface ExtractDateOptions {
  /** The role of the date, as a noun phrase: "the date the package was supposed to arrive". */
  role: string;
  /** Today's date, as YYYY-MM-DD. Relative dates resolve against it. */
  today: string;
  /** Earliest and latest years to offer. Default: 10 years either side of today. */
  years?: [number, number];
  /** For a bare weekday ("Tuesday") with no week given: the next one, or the last one. Default "next". */
  bareWeekday?: "next" | "last";
  /** Flag for review when confidence is under this. Default 0.6. */
  reviewBelow?: number;
  name?: string;
}

export interface ExtractedDate {
  /** YYYY-MM-DD, or null when the text gives no date or the parts don't make one. */
  date: string | null;
  confidence: number;
  /** True when a person should check: low confidence, or parts that don't add up. */
  review: boolean;
  /** Why it's null or flagged. */
  note?: string;
  parts: Record<string, string>;
}

type Part = "mode" | "month" | "day" | "year" | "anchor" | "weekday" | "week";

export function extractDate(text: Text, opts: ExtractDateOptions): Task<ExtractedDate> {
  const t = place(text, opts.name ?? "text");
  const today = parseDay(opts.today);
  const [y0, y1] = opts.years ?? [today.getUTCFullYear() - 10, today.getUTCFullYear() + 10];
  const notStated = "The text doesn't state this.";
  return {
    parts: t.parts,
    questions: (at) => {
      const r = t.ref(at);
      const about = q`${opts.role}, as given in ${r}`;
      const years: Record<string, string | null> = {};
      for (let y = y0; y <= y1; y++) years[String(y)] = null;
      return {
        mode: choice(q`How does ${r} give ${opts.role}?`, {
          absolute: "As a calendar date, with at least a month and a day (\"March 3\", \"3/14\").",
          relative: "Relative to today (\"tomorrow\", \"yesterday\", \"next Tuesday\", \"last Friday\").",
          none: "It doesn't give this date.",
        }),
        month: choice(`For ${about}: which month?`, { ...Object.fromEntries(MONTHS.map((m) => [m, null])), none: notStated }),
        day: choice(`For ${about}: which day of the month?`, { ...Object.fromEntries(Array.from({ length: 31 }, (_, i) => [String(i + 1), null])), none: notStated }),
        year: choice(`For ${about}: which year?`, { ...years, other: "A year is stated, but it isn't one of these.", none: notStated }),
        anchor: choice(`For ${about}: which day is it, relative to today?`, {
          today: "Today.",
          tomorrow: "Tomorrow.",
          day_after: "The day after tomorrow.",
          yesterday: "Yesterday.",
          weekday: "A named day of the week (\"Tuesday\", \"next Friday\").",
          none: notStated,
        }),
        weekday: choice(`For ${about}: which day of the week is named?`, { ...Object.fromEntries(WEEKDAYS.map((d) => [d, null])), none: notStated }),
        week: choice(`For ${about}: which week is that day of the week in?`, {
          current: "This week.",
          next: "Next week.",
          last: "Last week.",
          none: "No week is stated.",
        }),
      };
    },
    read: (a) => {
      const parts = {} as Record<Part, ChoiceReading>;
      for (const k of ["mode", "month", "day", "year", "anchor", "weekday", "week"] as Part[]) parts[k] = readChoice(a[k]);
      return assembleDate(parts, today, opts.bareWeekday ?? "next", opts.reviewBelow ?? 0.6);
    },
  };
}

/** Turn the parts' readings into a date. Exported so the rules can be tested without Jev. */
export function assembleDate(parts: Record<Part, ChoiceReading>, today: Date, bareWeekday: "next" | "last", reviewBelow: number): ExtractedDate {
  const v = Object.fromEntries(Object.entries(parts).map(([k, r]) => [k, r.value])) as Record<Part, string>;
  const conf = (...ks: Part[]) => lowest(...ks.map((k) => parts[k].confidence));
  const out = (date: string | null, used: Part[], note?: string): ExtractedDate => {
    const confidence = conf(...used);
    return { date, confidence, review: date === null ? v.mode !== "none" || confidence < reviewBelow : confidence < reviewBelow, ...(note ? { note } : {}), parts: v };
  };
  if (v.mode === "none") return out(null, ["mode"], "no date given");
  if (v.mode === "absolute") {
    const used: Part[] = ["mode", "month", "day", "year"];
    if (v.month === "none" || v.day === "none") return out(null, used, "the date is missing its month or day");
    if (v.year === "other") return out(null, used, "the year isn't in the range offered");
    const month = MONTHS.indexOf(v.month as (typeof MONTHS)[number]);
    const day = Number(v.day);
    let year = v.year === "none" ? today.getUTCFullYear() : Number(v.year);
    if (v.year === "none") {
      // No year: this year, unless that's more than a month ago, then next year.
      const candidate = Date.UTC(year, month, day);
      if (candidate < today.getTime() - 31 * 86_400_000) year += 1;
    }
    const d = new Date(Date.UTC(year, month, day));
    if (d.getUTCMonth() !== month) return out(null, used, `there's no ${v.month} ${day}`);
    return out(iso(d), v.year === "none" ? ["mode", "month", "day"] : used);
  }
  // Relative.
  const offsets: Record<string, number> = { today: 0, tomorrow: 1, day_after: 2, yesterday: -1 };
  if (v.anchor in offsets) return out(iso(addDays(today, offsets[v.anchor]!)), ["mode", "anchor"]);
  if (v.anchor === "weekday" && v.weekday !== "none") {
    const target = WEEKDAYS.indexOf(v.weekday as (typeof WEEKDAYS)[number]);
    const todayIdx = (today.getUTCDay() + 6) % 7; // Monday = 0
    const monday = addDays(today, -todayIdx);
    let d: Date;
    if (v.week === "current") d = addDays(monday, target);
    else if (v.week === "next") d = addDays(monday, 7 + target);
    else if (v.week === "last") d = addDays(monday, -7 + target);
    else if (bareWeekday === "next") d = addDays(today, (target - todayIdx + 7) % 7);
    else d = addDays(today, -((todayIdx - target + 7) % 7));
    return out(iso(d), ["mode", "anchor", "weekday", "week"]);
  }
  return out(null, ["mode", "anchor"], "a relative date without a day it's relative to");
}

function parseDay(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`today must be YYYY-MM-DD (got "${s}")`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
