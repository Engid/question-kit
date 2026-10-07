// Strategies for turning a pizza order into items: from all code to (almost) all Jev.
//
//   rung 0  keywords                   code only: the menu's word lists tag words; rules group them
//   rung 1  keywords-jev-fills-gaps    the same, and Jev tags only the words the lists don't know
//   rung 2  code-splits-jev-fills      code splits the order into items; Jev answers menu questions
//                                      about each item (pizza or drink, how many, size, every topping…)
//   rung 3  jev-tags-words             Jev tags every word from the whole menu; the same rules group them
//   rung 4  jev-splits-jev-fills       Jev says where each item starts, then answers the menu questions
//
// Each one is a short function: the Jev calls and the code between them.

import { CallLog, type CallRecord, type CallStats, type CodeStep } from "../../src/calls.ts";
import type { Entry, JevClient } from "../../src/jev/types.ts";
import { askItem, askItemStarts, askWordTags, readItem, readWordTags, type Wording } from "./questions.ts";
import { loadMenu, type WordTag } from "./menu.ts";
import { type Item, orderToExr } from "./order.ts";
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
}

export interface PizzaStrategy {
  name: string;
  group: "ladder" | "experiment";
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

// ------------------------------------------------------------------ rung 0

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

// ------------------------------------------------------------------ rung 1

export const keywordsJevFillsGaps: PizzaStrategy = {
  name: "keywords-jev-fills-gaps",
  group: "ladder",
  rung: 1,
  usesJev: true,
  summary: "The word lists tag what they know; Jev tags only the words they don't (\"more\", \"hamburger\", \"coca-cola\"); the same rules group them.",
  async parse(input, jev) {
    const menu = loadMenu();
    const log = new CallLog(jev);
    const tags = keywordTags(input.words, menu);
    const unknown = range(1, input.words.length).filter((w) => tags[w] === "none");
    log.note(`Word lists: ${describeTags(input, tags) || "(nothing recognized)"}. Asking Jev about the other ${unknown.length} words.`);
    const answers = await log.call("tags for the words the lists don't know", wordsState(input), askWordTags(unknown, menu));
    const readings = readWordTags(answers, unknown);
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
    return result("keywords-jev-fills-gaps", items, spans, log, ps.length ? Math.min(...ps) : 1);
  },
};

// ------------------------------------------------------------------ rungs 2 and 4: menu questions per item

async function fillItems(name: string, input: PizzaInput, log: CallLog, spans: [number, number][], wording: Wording, extraConfidence: number[] = []): Promise<PizzaResult> {
  const menu = loadMenu();
  const spanText = (s: [number, number]) => input.words.slice(s[0] - 1, s[1]).join(" ");
  const state: Entry = { order: input.text, items: Object.fromEntries(spans.map((s, k) => [`i${k + 1}`, spanText(s)])) };
  const batches = spans.map((s, k) => askItem(k + 1, range(s[0], s[1]), menu, wording));
  const answers = await log.call(`menu questions for ${spans.length} item${spans.length === 1 ? "" : "s"}`, state, ...batches);
  const readings = spans.map((_, k) => readItem(answers, k + 1, menu));
  const items = readings.flatMap((r) => (r.item ? [r.item] : []));
  const dropped = readings.filter((r) => !r.item).length;
  log.note(`Built ${items.length} item${items.length === 1 ? "" : "s"} from Jev's answers${dropped ? ` (${dropped} part${dropped === 1 ? "" : "s"} ordered nothing)` : ""}.`);
  const confidence = Math.min(1, ...extraConfidence, ...readings.map((r) => r.confidence));
  return result(name, items, spans, log, confidence);
}

function codeSplitsJevFills(name: string, wording: Wording, group: PizzaStrategy["group"], summary: string, rung?: number): PizzaStrategy {
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
      return fillItems(name, input, log, parts, wording);
    },
  };
}

export const codeSplitsJevFillsStrategy = codeSplitsJevFills(
  "code-splits-jev-fills",
  "full",
  "ladder",
  "Code splits the order into items (word lists + rules); Jev answers menu questions about each item: pizza or drink, how many, size, and one question per style and topping (1 call).",
  2,
);

export const jevSplitsJevFills: PizzaStrategy = {
  name: "jev-splits-jev-fills",
  group: "ladder",
  rung: 4,
  usesJev: true,
  summary: "Jev says where each item starts (call 1); code cuts the order there; Jev answers the menu questions about each item (call 2).",
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
    return fillItems("jev-splits-jev-fills", input, log, spans, "full", ps);
  },
};

// ------------------------------------------------------------------ rung 3

function jevTagsWords(name: string, opts: { nested?: boolean; wording?: Wording }, group: PizzaStrategy["group"], summary: string, rung?: number): PizzaStrategy {
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
      const readings = readWordTags(answers, words, opts.nested);
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

// ------------------------------------------------------------------ experiments and lineup

export const PIZZA_LINEUP: PizzaStrategy[] = [keywords, keywordsJevFillsGaps, codeSplitsJevFillsStrategy, jevTagsWordsStrategy, jevSplitsJevFills];

export const PIZZA_EXPERIMENTS: PizzaStrategy[] = [
  jevTagsWords("jev-tags-words/nested", { nested: true }, "experiment", "Like jev-tags-words, but each word is asked in two levels: what kind of thing (topping, size, drink…), then which one."),
  jevTagsWords("jev-tags-words/bare-names", { wording: "bare" }, "experiment", "Like jev-tags-words, but options are bare menu names: no other spellings, no \"not the same as\" notes."),
  codeSplitsJevFills("code-splits-jev-fills/bare-names", "bare", "experiment", "Like code-splits-jev-fills, but the questions use bare menu names: no other spellings, no \"not the same as\" notes."),
];

export const PIZZA_ALL = [...PIZZA_LINEUP, ...PIZZA_EXPERIMENTS];

export function getPizzaStrategy(name: string): PizzaStrategy {
  const s = PIZZA_ALL.find((x) => x.name === name);
  if (!s) throw new Error(`unknown pizza strategy "${name}"; try: ${PIZZA_ALL.map((x) => x.name).join(", ")}`);
  return s;
}
