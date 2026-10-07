// Strategies for turning a pizza order into items: from all code to (almost) all Jev.
//
//   dial 0  keywords                   code only: the menu's word lists tag words; rules group them
//   dial 1  keywords-jev-fills-gaps    the same, and Jev tags only the words the lists don't know
//   dial 2  code-splits-jev-fills      code splits the order into items; Jev answers menu questions
//                                      about each item (pizza or drink, how many, size, every topping…)
//   dial 3  jev-tags-words             Jev tags every word from the whole menu; the same rules group them
//   dial 4  jev-splits-jev-fills       Jev says where each item starts, then answers the menu questions
//
// Each one is a short function: the Jev calls and the code between them.
//
// Experiments on top of the ladder (--all):
//   …/follow-up     ask again about the words Jev was under 90% sure of, with fewer options
//   …+check         read the finished order back to Jev: is anything wrong? (an accept-or-confirm signal)
//   pick-dial-1-or-3  run dials 1 and 3; when they disagree, Jev picks the order that matches
//   …/examples      TypeSafe's structured criteria: each option with what, not_for and examples

import { type Answers, CallLog, type CallRecord, type CallStats, type CodeStep } from "../lab/calls.ts";
import type { Entry, JevClient } from "../lab/jev/types.ts";
import {
  askItem,
  askItemStarts,
  askOrderCheck,
  askOrderPick,
  askTagFollowUps,
  askWordTags,
  candidateEntries,
  type OrderCheck,
  readBackOrder,
  readItem,
  readOrderCheck,
  readOrderPick,
  readTagFollowUps,
  readWordTags,
  type TagOptions,
  type TagReading,
  topOptions,
  type Wording,
} from "./questions.ts";
import { loadMenu, type Menu, type WordTag } from "./menu.ts";
import { type Item, orderToExr, sameOrder } from "./order.ts";
import { PIZZA_ORDER_TAKER } from "../../examples/order-taker/pizza/eval.ts";
import { assemble, keywordTags } from "./rules.ts";

export interface PizzaInput {
  text: string;
  words: string[];
}

export interface PizzaResult {
  strategy: string;
  items: Item[];
  exr: string;
  /** The parts the strategy worked with, as [first, last] word ids. */
  spans: [number, number][];
  calls: CallRecord[];
  steps: CodeStep[];
  stats: CallStats;
  /** For Jev strategies: the lowest top-answer probability among the answers the order was built from. */
  confidence?: number;
  /** With a whole-order check: Jev's probability that the order read back is wrong. */
  check?: OrderCheck;
  /** For pick-between: whether the two designs built the same order, and how sure Jev was of its pick when they didn't. */
  agreed?: boolean;
  pick?: { choice: "first" | "second" | "neither"; p: number };
}

export interface PizzaStrategy {
  name: string;
  group: "ladder" | "experiment" | "library";
  rung?: number;
  summary: string;
  usesJev: boolean;
  parse(input: PizzaInput, jev: JevClient): Promise<PizzaResult>;
}

const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);

function result(strategy: string, items: Item[], spans: [number, number][], log: CallLog, confidence?: number): PizzaResult {
  return { strategy, items, exr: orderToExr(items), spans, calls: log.calls, steps: log.steps, stats: log.stats, ...(confidence !== undefined ? { confidence } : {}) };
}

const wordsState = (input: PizzaInput): Entry => ({ order: input.text, words: Object.fromEntries(input.words.map((w, i) => [`w${i + 1}`, w])) });

function describeTags(input: PizzaInput, tags: WordTag[]): string {
  return input.words
    .map((w, i) => (tags[i + 1] && tags[i + 1] !== "none" ? `${w}=${tags[i + 1]}` : ""))
    .filter(Boolean)
    .join(" ");
}

// ------------------------------------------------------------------ dial 0

export const keywords: PizzaStrategy = {
  name: "keywords",
  group: "ladder",
  rung: 0,
  usesJev: false,
  summary: "Code only: the menu's word lists tag each word (\"black olives\" → olives); rules group the tags into items.",
  async parse(input, jev) {
    const log = new CallLog(jev);
    const tags = keywordTags(input.words);
    log.note(`Word lists: ${describeTags(input, tags) || "(nothing recognized)"}`);
    const { items, spans } = assemble(input.words, tags);
    log.note(`Rules grouped them into ${items.length} item${items.length === 1 ? "" : "s"}.`);
    return result("keywords", items, spans, log);
  },
};

// ------------------------------------------------------------------ dial 1

/** Below this, a word's tag counts as unsure: the follow-up experiments ask about it again. */
export const SURE = 0.9;

/** Ask again about the words Jev was unsure of; the follow-up answers replace the first ones. */
async function followUpUnsure(input: PizzaInput, log: CallLog, menu: Menu, opts: TagOptions, answers: Answers, readings: Map<number, TagReading>): Promise<Map<number, TagReading>> {
  const unsure = [...readings].filter(([, r]) => r.p < SURE).map(([word]) => {
    const a = answers[`tag_w${word}`];
    return { word, options: a && "probabilities" in a ? topOptions(a.probabilities) : [] };
  });
  if (!unsure.length) {
    log.note(`Jev was at least ${SURE * 100}% sure of every word: no follow-up.`);
    return readings;
  }
  log.note(`Asking again about the ${unsure.length} word${unsure.length === 1 ? "" : "s"} Jev was less than ${SURE * 100}% sure of, with only the options it was torn between (plus "none"): ${unsure.map((u) => `"${input.words[u.word - 1]}"`).join(", ")}.`);
  const again = readTagFollowUps(await log.call("follow-up for unsure words", wordsState(input), askTagFollowUps(input.words, unsure, menu, opts)), unsure.map((u) => u.word));
  const out = new Map(readings);
  const changed: string[] = [];
  for (const [w, r] of again) {
    if (r.tag !== readings.get(w)?.tag) changed.push(`"${input.words[w - 1]}" ${readings.get(w)?.tag} → ${r.tag}`);
    out.set(w, r);
  }
  log.note(changed.length ? `The follow-up changed: ${changed.join(", ")}.` : "The follow-up kept every tag (with new probabilities).");
  return out;
}

function keywordsJevFills(name: string, opts: TagOptions & { followUp?: boolean }, group: PizzaStrategy["group"], summary: string, rung?: number): PizzaStrategy {
  return {
    name,
    group,
    ...(rung !== undefined ? { rung } : {}),
    usesJev: true,
    summary,
    async parse(input, jev) {
      const menu = loadMenu();
      const log = new CallLog(jev);
      const tags = keywordTags(input.words, menu);
      const unknown = range(1, input.words.length).filter((w) => tags[w] === "none");
      log.note(`Word lists: ${describeTags(input, tags) || "(nothing recognized)"}. Asking Jev about the other ${unknown.length} words.`);
      const answers = await log.call("tags for the words the lists don't know", wordsState(input), askWordTags(unknown, menu, opts));
      let readings = readWordTags(answers, unknown);
      if (opts.followUp) readings = await followUpUnsure(input, log, menu, opts, answers, readings);
      const changed: string[] = [];
      for (const [w, r] of readings) {
        if (r.tag !== "none") {
          tags[w] = r.tag;
          changed.push(`${input.words[w - 1]}=${r.tag}`);
        }
      }
      log.note(changed.length ? `Jev tagged: ${changed.join(" ")}` : "Jev found nothing more in those words.");
      const { items, spans } = assemble(input.words, tags, menu);
      log.note(`Rules grouped them into ${items.length} item${items.length === 1 ? "" : "s"}.`);
      const ps = [...readings.values()].map((r) => r.p);
      return result(name, items, spans, log, ps.length ? Math.min(...ps) : 1);
    },
  };
}

export const keywordsJevFillsGaps = keywordsJevFills(
  "keywords-jev-fills-gaps",
  {},
  "ladder",
  "The word lists tag what they know; Jev tags only the words they don't (\"more\", \"hamburger\", \"coca-cola\"); the same rules group them.",
  1,
);

// ------------------------------------------------------------------ dials 2 and 4: menu questions per item

interface FillOptions {
  wording: Wording;
  /** Ask only about styles and toppings sharing a word with the part (code answers "no" for the rest). */
  candidates?: boolean;
  /** The style and topping answers as structured criteria with examples. */
  examples?: boolean;
}

async function fillItems(name: string, input: PizzaInput, log: CallLog, spans: [number, number][], o: FillOptions, extraConfidence: number[] = []): Promise<PizzaResult> {
  const menu = loadMenu();
  const spanText = (s: [number, number]) => input.words.slice(s[0] - 1, s[1]).join(" ");
  const state: Entry = { order: input.text, items: Object.fromEntries(spans.map((s, k) => [`i${k + 1}`, spanText(s)])) };
  const only = o.candidates ? spans.map((s) => candidateEntries(spanText(s), menu)) : undefined;
  if (only) log.note(`Code kept the styles and toppings that share a word with each part: ${only.map((c, k) => `item ${k + 1}: ${[...c].map((e) => e.toLowerCase().replace(/_/g, " ")).join(", ") || "none"}`).join("; ")}.`);
  const batches = spans.map((s, k) => askItem(k + 1, range(s[0], s[1]), menu, o.wording, only?.[k], o.examples));
  const answers = await log.call(`menu questions for ${spans.length} item${spans.length === 1 ? "" : "s"}`, state, ...batches);
  const readings = spans.map((_, k) => readItem(answers, k + 1, menu));
  const items = readings.flatMap((r) => (r.item ? [r.item] : []));
  const dropped = readings.filter((r) => !r.item).length;
  log.note(`Built ${items.length} item${items.length === 1 ? "" : "s"} from Jev's answers${dropped ? ` (${dropped} part${dropped === 1 ? "" : "s"} ordered nothing)` : ""}.`);
  const confidence = Math.min(1, ...extraConfidence, ...readings.map((r) => r.confidence));
  return result(name, items, spans, log, confidence);
}

function codeSplitsJevFills(name: string, fill: FillOptions, group: PizzaStrategy["group"], summary: string, rung?: number): PizzaStrategy {
  return {
    name,
    group,
    ...(rung !== undefined ? { rung } : {}),
    usesJev: true,
    summary,
    async parse(input, jev) {
      const log = new CallLog(jev);
      const { spans } = assemble(input.words, keywordTags(input.words));
      // An order where the word lists find nothing is still one item for Jev to read.
      const parts: [number, number][] = spans.length ? spans : [[1, input.words.length]];
      log.note(`Code split the order into ${parts.length} part${parts.length === 1 ? "" : "s"}: ${parts.map((s) => `"${input.words.slice(s[0] - 1, s[1]).join(" ")}"`).join(" | ")}`);
      return fillItems(name, input, log, parts, fill);
    },
  };
}

export const codeSplitsJevFillsStrategy = codeSplitsJevFills(
  "code-splits-jev-fills",
  { wording: "full" },
  "ladder",
  "Code splits the order into items (word lists + rules); Jev answers menu questions about each item: pizza or drink, how many, size, and one question per style and topping (1 call).",
  2,
);

export const jevSplitsJevFills = jevSplits(
  "jev-splits-jev-fills",
  { wording: "full" },
  "ladder",
  "Jev says where each item starts (call 1); code cuts the order there; Jev answers the menu questions about each item (call 2).",
  4,
);

function jevSplits(name: string, fill: FillOptions, group: PizzaStrategy["group"], summary: string, rung?: number): PizzaStrategy {
  return {
    name,
    group,
    ...(rung !== undefined ? { rung } : {}),
    usesJev: true,
    summary,
    async parse(input, jev) {
      const log = new CallLog(jev);
      const n = input.words.length;
      const answers = await log.call("where items start", wordsState(input), askItemStarts(n));
      const starts = [1];
      const ps: number[] = [];
      for (let w = 2; w <= n; w++) {
        const a = answers[`start_w${w}`];
        const p = a && "noul" in a ? a.noul : 0;
        ps.push(Math.max(p, 1 - p));
        if (p >= 0.5) starts.push(w);
      }
      const spans: [number, number][] = starts.map((s, k) => [s, (starts[k + 1] ?? n + 1) - 1]);
      log.note(`Cut the order where Jev said items start: ${spans.map((s) => `"${input.words.slice(s[0] - 1, s[1]).join(" ")}"`).join(" | ")}`);
      return fillItems(name, input, log, spans, fill, ps);
    },
  };
}

// ------------------------------------------------------------------ dial 3

function jevTagsWords(name: string, opts: TagOptions & { followUp?: boolean }, group: PizzaStrategy["group"], summary: string, rung?: number): PizzaStrategy {
  return {
    name,
    group,
    ...(rung !== undefined ? { rung } : {}),
    usesJev: true,
    summary,
    async parse(input, jev) {
      const menu = loadMenu();
      const log = new CallLog(jev);
      const words = range(1, input.words.length);
      const answers = await log.call("what each word is", wordsState(input), askWordTags(words, menu, opts));
      let readings = readWordTags(answers, words, opts.nested);
      if (opts.followUp) readings = await followUpUnsure(input, log, menu, opts, answers, readings);
      const tags: WordTag[] = ["", ...words.map((w) => readings.get(w)?.tag ?? "none")];
      log.note(`Jev's tags: ${describeTags(input, tags) || "(nothing)"}`);
      const { items, spans } = assemble(input.words, tags, menu);
      log.note(`Rules grouped them into ${items.length} item${items.length === 1 ? "" : "s"}.`);
      return result(name, items, spans, log, Math.min(1, ...[...readings.values()].map((r) => r.p)));
    },
  };
}

export const jevTagsWordsStrategy = jevTagsWords(
  "jev-tags-words",
  {},
  "ladder",
  "Jev tags every word with one Choice over the whole menu (~170 options: each topping, size, drink…, plus 'no', 'extra' and 'nothing'); the same rules as rung 0 group the tags into items.",
  3,
);

// ------------------------------------------------------------------ checking the finished order

/** A result with more calls made after it (a check, or a second design), as one result. */
function extend(name: string, base: PizzaResult, log: Pick<PizzaResult, "calls" | "steps" | "stats">, more: Partial<PizzaResult> = {}): PizzaResult {
  const stats = { ...base.stats };
  for (const k of Object.keys(stats) as (keyof CallStats)[]) stats[k] += log.stats[k];
  return {
    ...base,
    strategy: name,
    calls: [...base.calls, ...log.calls],
    steps: [...base.steps, ...log.steps.map((s) => ({ ...s, afterRequest: s.afterRequest + base.calls.length }))],
    stats,
    ...more,
  };
}

/**
 * The base strategy, then one more call: the order read back next to what the customer said, and
 * Jev asked whether it's wrong (whole order, each item, anything missing). The order itself is
 * unchanged; the check is a signal for accepting it or reading it back to the customer.
 */
function withCheck(base: PizzaStrategy): PizzaStrategy {
  return {
    name: `${base.name}+check`,
    group: "experiment",
    usesJev: true,
    summary: `${base.name}, then the order is read back to Jev next to what the customer said: is anything wrong? (whole order, each item, anything missing; 1 more call)`,
    async parse(input, jev) {
      const r = await base.parse(input, jev);
      const menu = loadMenu();
      const log = new CallLog(jev);
      const check = readOrderCheck(await log.call("check the order read back", { order: input.text, summary: readBackOrder(r.items, menu) }, askOrderCheck(r.items)), r.items.length);
      log.note(`Jev's check, P(wrong): whole order ${check.whole.toFixed(2)}; worst of each item and anything missing ${check.parts.toFixed(2)}.`);
      return extend(`${base.name}+check`, r, log, { check });
    },
  };
}

/**
 * Two designs on the same order. When they build the same order, that's the answer; when they
 * don't, Jev sees both read back and picks the one that matches (or neither, and the first design's
 * order is kept but flagged).
 */
function pickBetween(name: string, first: PizzaStrategy, second: PizzaStrategy): PizzaStrategy {
  return {
    name,
    group: "experiment",
    usesJev: true,
    summary: `Runs ${first.name} and ${second.name}; when their orders differ, Jev sees both read back and picks the one that matches what the customer said (1 more call, only then).`,
    async parse(input, jev) {
      const a = await first.parse(input, jev);
      const b = await second.parse(input, jev);
      const both = extend(name, a, b);
      const log = new CallLog(jev);
      const confidence = Math.max(a.confidence ?? 0, b.confidence ?? 0);
      if (sameOrder(a.exr, b.exr)) {
        log.note(`${first.name} and ${second.name} built the same order.`);
        return extend(name, both, log, { agreed: true, confidence });
      }
      // Which design is shown first alternates with the order text, so neither always gets position a.
      const swap = [...input.text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 1000003, 7) % 2 === 1;
      const { state, questions } = askOrderPick(input.text, a.items, b.items, loadMenu(), swap);
      const pick = readOrderPick(await log.call("pick between the two orders", state, questions), swap);
      const chosen = pick.pick === "second" ? b : a;
      log.note(`The designs disagree. Jev picked ${pick.pick === "neither" ? `neither (keeping ${first.name}'s order, flagged)` : pick.pick === "first" ? first.name : second.name} (p ${pick.p.toFixed(2)}).`);
      return extend(name, { ...both, items: chosen.items, exr: chosen.exr, spans: chosen.spans }, log, {
        agreed: false,
        confidence: chosen.confidence ?? 0,
        pick: { choice: pick.pick, p: pick.p },
      });
    },
  };
}

/**
 * Ways an app could decide to accept an order as is (true) or read it back to the customer
 * (false), from what a strategy reports.
 */
export function gatesOf(r: PizzaResult): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (r.confidence !== undefined && r.agreed === undefined) out[`every answer ≥ ${SURE}`] = r.confidence >= SURE;
  if (r.check) {
    out["check, whole order: P(wrong) < 0.5"] = r.check.whole < 0.5;
    out["check, each part: all P(wrong) < 0.5"] = r.check.parts < 0.5;
    out["check, each part: all P(wrong) < 0.3"] = r.check.parts < 0.3;
    if (r.confidence !== undefined) out[`every answer ≥ ${SURE}, or each part passes`] = r.confidence >= SURE || r.check.parts < 0.5;
  }
  if (r.agreed !== undefined) {
    out["the two designs agree"] = r.agreed;
    out[`agree, or Jev's pick ≥ ${SURE}`] = r.agreed || (r.pick !== undefined && r.pick.choice !== "neither" && r.pick.p >= SURE);
  }
  return out;
}

// ------------------------------------------------------------------ experiments and lineup

export const PIZZA_LINEUP: PizzaStrategy[] = [keywords, keywordsJevFillsGaps, codeSplitsJevFillsStrategy, jevTagsWordsStrategy, jevSplitsJevFills];

const namedCandidates = codeSplitsJevFills(
  "code-splits-jev-fills/named-candidates",
  { wording: "named", candidates: true },
  "experiment",
  "Like code-splits-jev-fills/named, but code only asks about styles and toppings that share a word with the item (\"cheese\" brings in every cheese); the rest are \"not named\".",
);

export const PIZZA_EXPERIMENTS: PizzaStrategy[] = [
  jevTagsWords("jev-tags-words/nested", { nested: true }, "experiment", "Like jev-tags-words, but each word is asked in two levels: what kind of thing (topping, size, drink…), then which one."),
  jevTagsWords("jev-tags-words/bare-names", { wording: "bare" }, "experiment", "Like jev-tags-words, but options are bare menu names: no other spellings, no \"not the same as\" notes."),
  codeSplitsJevFills("code-splits-jev-fills/bare-names", { wording: "bare" }, "experiment", "Like code-splits-jev-fills, but the questions use bare menu names: no other spellings, no \"not the same as\" notes."),
  codeSplitsJevFills(
    "code-splits-jev-fills/named",
    { wording: "named" },
    "experiment",
    "Like code-splits-jev-fills, but each style and topping question asks whether the customer names it (\"counts only if they say…; don't infer it\"), with notes both ways (\"plain 'peppers' is a different topping\").",
  ),
  namedCandidates,
  jevSplits("jev-splits-jev-fills/named", { wording: "named" }, "experiment", "Like jev-splits-jev-fills, with the named wording of code-splits-jev-fills/named."),
  // Follow-up when unsure
  keywordsJevFills(
    "keywords-jev-fills-gaps/follow-up",
    { followUp: true },
    "experiment",
    `Like keywords-jev-fills-gaps, then any word Jev was under ${SURE * 100}% sure of is asked again with only the options it was torn between, plus "none" (1 more call, only then).`,
  ),
  jevTagsWords(
    "jev-tags-words/follow-up",
    { followUp: true },
    "experiment",
    `Like jev-tags-words, then any word Jev was under ${SURE * 100}% sure of is asked again with only the options it was torn between, plus "none" (1 more call, only then).`,
  ),
  // Whole-order check
  withCheck(keywords),
  withCheck(keywordsJevFillsGaps),
  withCheck(jevTagsWordsStrategy),
  withCheck(namedCandidates),
  pickBetween("pick-dial-1-or-3", keywordsJevFillsGaps, jevTagsWordsStrategy),
  // Examples in questions
  jevTagsWords(
    "jev-tags-words/examples",
    { examples: true },
    "experiment",
    "Like jev-tags-words, but every option is TypeSafe's structured criteria: what it is, what it's not for, and examples (the menu's own spellings and made-up phrases).",
  ),
  codeSplitsJevFills(
    "code-splits-jev-fills/named-candidates/examples",
    { wording: "named", candidates: true, examples: true },
    "experiment",
    "Like code-splits-jev-fills/named-candidates, but each style and topping answer is structured criteria with made-up examples (\"extra olives\", \"hold the olives\") and what it's not for.",
  ),
];

export const PIZZA_ALL = [...PIZZA_LINEUP, ...PIZZA_EXPERIMENTS, ...PIZZA_ORDER_TAKER];

export function getPizzaStrategy(name: string): PizzaStrategy {
  const s = PIZZA_ALL.find((x) => x.name === name);
  if (!s) throw new Error(`unknown pizza strategy "${name}"; try: ${PIZZA_ALL.map((x) => x.name).join(", ")}`);
  return s;
}
