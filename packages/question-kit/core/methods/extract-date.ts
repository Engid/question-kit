// extractDate: a calendar date the text gives in a role you name.
//
// Jev never does calendar arithmetic. It answers Choice questions about the date's parts (written
// as a date or relative to today; month; day; year; which day it's anchored to; weekday; which
// week; a count of days or weeks; which month's end), and code turns the parts into a date against
// a fixed "today". The date's confidence is its least sure part; low ones, or parts that don't make
// a date, are flagged for review. When the text gives a date without a year, `expect` decides the
// year (past, future or nearest), and the result says the year was guessed; a bare day of the month
// ("on the 2nd") gets its month the same way.
// Based on the approach in TypeSafe's "Date extraction" cookbook, extended with past references
// ("yesterday", "last week"), counted offsets ("in three days", "two weeks ago") and month ends,
// which customer messages use a lot.

import { choice } from "../questions.ts";
import { type ChoiceReading, lowest, readChoice } from "../readings.ts";
import { q, type Text } from "../state.ts";
import { place, type Task } from "../task.ts";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/**
 * Where a date is expected to fall, for when the text leaves it open: "March 3" with no year, or a
 * bare "Tuesday". "past" for things that already happened (when an order was placed, when it was
 * due), "future" for things to come (a delivery, an appointment), "nearest" when it could be either.
 */
export type DateExpectation = "past" | "future" | "nearest";

export interface ExtractDateOptions {
  /** The role of the date, as a noun phrase: "the date the package was supposed to arrive". */
  role: string;
  /** Today's date, as YYYY-MM-DD. Relative dates resolve against it. */
  today: string;
  /**
   * When the text gives no year: the year that puts the date in the past (on or before today), in
   * the future (on or after today), or nearest to today. Default "nearest".
   */
  expect?: DateExpectation;
  /** Earliest and latest years to offer. Default: 10 years either side of today. */
  years?: [number, number];
  /** For a bare weekday ("Tuesday") with no week given: the next one, or the last one. Default "last" when expecting the past, otherwise "next". */
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
  /** True when the text gave a calendar date without a year, so the year was chosen by `expect`. */
  yearGuessed: boolean;
  /** True when the text gave only a day of the month ("the 2nd"), so the month was chosen by `expect`. */
  monthGuessed: boolean;
  parts: Record<string, string>;
}

type Part = "mode" | "month" | "day" | "year" | "anchor" | "weekday" | "week" | "span" | "count" | "period";
const PARTS: Part[] = ["mode", "month", "day", "year", "anchor", "weekday", "week", "span", "count", "period"];

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
          absolute: "As a calendar date: a month and a day (\"March 3\", \"3/14\"), or just a day of the month (\"the 2nd\").",
          relative: "Relative to today (\"tomorrow\", \"yesterday\", \"next Tuesday\", \"last Friday\", \"in three days\", \"two weeks ago\", \"the end of this month\").",
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
          counted: "A number of days or weeks from today, ahead or back (\"in three days\", \"two weeks ago\", \"a week from today\").",
          month_end: "The end of a month (\"the end of this month\", \"end of next month\").",
          none: notStated,
        }),
        weekday: choice(`For ${about}: which day of the week is named?`, { ...Object.fromEntries(WEEKDAYS.map((d) => [d, null])), none: notStated }),
        week: choice(`For ${about}: which week is that day of the week in?`, {
          current: "This week.",
          next: "Next week.",
          last: "Last week.",
          none: "No week is stated.",
        }),
        span: choice(`For ${about}: when it is counted from today, in what and which way?`, {
          days_ahead: "A number of days ahead (\"in three days\").",
          days_ago: "A number of days back (\"two days ago\").",
          weeks_ahead: "A number of weeks ahead (\"in two weeks\", \"a week from today\").",
          weeks_ago: "A number of weeks back (\"two weeks ago\").",
          none: "It isn't counted from today.",
        }),
        count: choice(`For ${about}: how many days or weeks are counted (\"a week\" is 1)?`, { ...Object.fromEntries(Array.from({ length: 31 }, (_, i) => [String(i + 1), null])), none: "No number of days or weeks is stated." }),
        period: choice(`For ${about}: when it is the end of a month, which month?`, {
          current: "This month.",
          next: "Next month.",
          last: "Last month.",
          none: "It isn't the end of a month.",
        }),
      };
    },
    read: (a) => {
      const parts = {} as Record<Part, ChoiceReading>;
      for (const k of PARTS) parts[k] = readChoice(a[k]);
      const expect = opts.expect ?? "nearest";
      return assembleDate(parts, today, opts.bareWeekday ?? (expect === "past" ? "last" : "next"), opts.reviewBelow ?? 0.6, expect);
    },
  };
}

/** Turn the parts' readings into a date. Exported so the rules can be tested without Jev. */
export function assembleDate(parts: Record<Part, ChoiceReading>, today: Date, bareWeekday: "next" | "last", reviewBelow: number, expect: DateExpectation = "nearest"): ExtractedDate {
  const v = Object.fromEntries(Object.entries(parts).map(([k, r]) => [k, r.value])) as Record<Part, string>;
  const conf = (...ks: Part[]) => lowest(...ks.map((k) => parts[k].confidence));
  const yearGuessed = v.mode === "absolute" && v.year === "none";
  const monthGuessed = v.mode === "absolute" && v.month === "none" && v.day !== "none";
  const out = (date: string | null, used: Part[], note?: string): ExtractedDate => {
    const confidence = conf(...used);
    return { date, confidence, review: date === null ? v.mode !== "none" || confidence < reviewBelow : confidence < reviewBelow, ...(note ? { note } : {}), yearGuessed, monthGuessed, parts: v };
  };
  const t = today.getTime();
  // The candidate that fits `expect`: the latest on or before today, the earliest on or after it, or the nearest.
  const fitting = (candidates: Date[]) =>
    expect === "past"
      ? candidates.filter((d) => d.getTime() <= t).at(-1)
      : expect === "future"
        ? candidates.find((d) => d.getTime() >= t)
        : candidates.reduce<Date | undefined>((best, d) => (best === undefined || Math.abs(d.getTime() - t) < Math.abs(best.getTime() - t) ? d : best), undefined);
  if (v.mode === "none") return out(null, ["mode"], "no date given");
  // The parts are answered independently, so the summary question (`mode`) can disagree with the
  // details. Assemble the reading `mode` chose; if its parts don't make a date, try the other reading
  // (with `mode`'s confidence counted against it); if both readings make a date, say so for review.
  const absolute = () => assembleAbsolute();
  const relative = () => assembleRelative();
  const first = v.mode === "absolute" ? absolute() : relative();
  const other = v.mode === "absolute" ? relative() : absolute();
  if (first.date === null && other.date !== null) return { ...other, confidence: lowest(other.confidence, parts.mode.confidence), review: true, note: `read as ${v.mode === "absolute" ? "relative" : "a calendar date"} although the text seemed to give it the other way` };
  if (first.date !== null && other.date !== null && first.date !== other.date) return { ...first, review: true, note: `the parts also read as ${other.date}` };
  return first;

  function assembleAbsolute(): ExtractedDate {
    const used: Part[] = ["mode", "month", "day", "year"];
    if (v.day === "none") return out(null, used, "the date is missing its day");
    if (v.month === "none") {
      // Only a day of the month: last month, this month or next month, whichever fits `expect`.
      const day = Number(v.day);
      const y = today.getUTCFullYear();
      const m = today.getUTCMonth();
      const candidates = [-1, 0, 1].map((k) => new Date(Date.UTC(y, m + k, day))).filter((d, i) => d.getUTCMonth() === ((m + [-1, 0, 1][i]! + 12) % 12));
      const pick = fitting(candidates);
      if (!pick) return out(null, ["mode", "day"], `there's no day ${day} in a nearby month`);
      return out(iso(pick), ["mode", "day"]);
    }
    if (v.year === "other") return out(null, used, "the year isn't in the range offered");
    const month = MONTHS.indexOf(v.month as (typeof MONTHS)[number]);
    const day = Number(v.day);
    if (v.year !== "none") {
      const d = new Date(Date.UTC(Number(v.year), month, day));
      if (d.getUTCMonth() !== month) return out(null, used, `there's no ${v.month} ${day}, ${v.year}`);
      return out(iso(d), used);
    }
    // No year: last year, this year or next year, whichever fits `expect`.
    const y = today.getUTCFullYear();
    const candidates = [y - 1, y, y + 1].map((year) => new Date(Date.UTC(year, month, day))).filter((d) => d.getUTCMonth() === month);
    const pick = fitting(candidates);
    if (!pick) return out(null, ["mode", "month", "day"], `there's no ${v.month} ${day}`);
    return out(iso(pick), ["mode", "month", "day"]);
  }

  function assembleRelative(): ExtractedDate {
  const offsets: Record<string, number> = { today: 0, tomorrow: 1, day_after: 2, yesterday: -1 };
  if (v.anchor in offsets) return out(iso(addDays(today, offsets[v.anchor]!)), ["mode", "anchor"]);
  if (v.anchor === "counted") {
    const used: Part[] = ["mode", "anchor", "span", "count"];
    if (v.span === "none" || v.count === "none") return out(null, used, "counted from today, but the count or its direction isn't stated");
    const n = Number(v.count) * (v.span.startsWith("weeks") ? 7 : 1) * (v.span.endsWith("ago") ? -1 : 1);
    return out(iso(addDays(today, n)), used);
  }
  if (v.anchor === "month_end") {
    const used: Part[] = ["mode", "anchor", "period"];
    if (v.period === "none") return out(null, used, "the end of a month, but which month isn't stated");
    const k = v.period === "next" ? 1 : v.period === "last" ? -1 : 0;
    // Day 0 of the month after is the last day of the month wanted.
    return out(iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + k + 1, 0))), used);
  }
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
