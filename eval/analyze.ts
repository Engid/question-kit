// Error analysis for Jev strategies, from cached answers (no API calls by default).
//
//   bun eval/analyze.ts --strategies head-selection --per-bucket 25 [--client replay|oracle] [--split dev] [--unlabeled]
//
// For each strategy it reports:
//   - head accuracy by gold relation, and label accuracy when the head is right
//   - what kind of head errors happen: inverted (the word took its own dependent as head), too high
//     (its grandparent), sibling (another dependent of its true head), or other
//   - mutual first-ranked pairs (a → b and b → a): how they relate to the gold tree
//   - option-order effects: how often Jev's top head is the first option, against how often the
//     gold head is; and head accuracy by the gold head's position in the option list
//   - head accuracy by distance to the gold head and by whether the POS tag was right

import { parseArgs } from "node:util";
import { join } from "node:path";
import { oracleClient } from "../src/jev/oracle.ts";
import { RecordingJevClient } from "../src/jev/recording.ts";
import type { JevClient } from "../src/jev/types.ts";
import { headSelection } from "../src/strategies/head-selection/index.ts";
import { getStrategy } from "../src/strategies/registry.ts";
import type { ParseResult } from "../src/types.ts";
import type { ConlluSentence } from "../src/ud/conllu.ts";
import { universalDeprel } from "../src/ud/deprel.ts";
import { loadSplit, sample, type Split } from "./data.ts";
import { pct, printTable } from "./table.ts";

const { values: args } = parseArgs({
  options: {
    strategies: { type: "string", default: "head-selection" },
    split: { type: "string", default: "dev" },
    "per-bucket": { type: "string", default: "25" },
    "max-len": { type: "string" },
    client: { type: "string", default: "replay" },
    top: { type: "string", default: "15" },
    unlabeled: { type: "boolean", default: false },
  },
});

const sentences = sample(loadSplit(args.split as Split), {
  perBucket: Number(args["per-bucket"]),
  maxLen: args["max-len"] ? Number(args["max-len"]) : undefined,
});
const cache = new RecordingJevClient(undefined, join(import.meta.dir, "..", ".cache", "jev"), "replay");
const clientFor = (g: ConlluSentence): JevClient => (args.client === "oracle" ? oracleClient(g.words) : cache);
const top = Number(args.top);

interface WordObs {
  d: number;
  n: number;
  form: string;
  goldHead: number;
  goldRel: string;
  goldUpos: string;
  predUpos: string;
  head: number;
  argmax: number;
  rel: string;
  /** Head ids in the order they were offered (sentence order: words, then root). */
  optionOrder: number[];
  firstOptionP: number;
  goldHeadOfGoldHead: number;
  goldDependents: number[];
  kindDecoded: string;
}

function observe(g: ConlluSentence, r: ParseResult): WordObs[] {
  const n = g.words.length;
  const goldHead = (id: number) => (id === 0 ? -1 : (g.words[id - 1]?.head ?? -1));
  return g.words.map((w, i) => {
    const d = i + 1;
    const e = r.edges[i]!;
    const optionOrder = [...Array.from({ length: n }, (_, k) => k + 1).filter((h) => h !== d), 0];
    const first = optionOrder[0] as number;
    return {
      d,
      n,
      form: w.form,
      goldHead: w.head,
      goldRel: universalDeprel(w.deprel),
      goldUpos: w.upos,
      predUpos: r.tokens[i]!.upos,
      head: e.head,
      argmax: e.argmaxHead,
      rel: universalDeprel(e.deprel),
      optionOrder,
      firstOptionP: e.headDist[String(first)] ?? 0,
      goldHeadOfGoldHead: goldHead(w.head),
      goldDependents: g.words.filter((x) => x.head === d).map((x) => x.id),
      kindDecoded: "",
    };
  });
}

function errorKind(o: WordObs, head: number): string {
  if (head === o.goldHead) return "correct";
  if (o.goldDependents.includes(head)) return "inverted (took its own dependent)";
  if (head === o.goldHeadOfGoldHead) return "too high (took its grandparent)";
  if (head !== 0 && head !== o.d && sentencesGoldHeadOf(o, head) === o.goldHead) return "sibling (another dependent of its head)";
  if (head === 0) return "root instead";
  if (o.goldHead === 0) return "was the root";
  return "other";
}
// Filled per sentence before classification.
let currentGold: ConlluSentence | undefined;
function sentencesGoldHeadOf(_o: WordObs, id: number): number {
  return currentGold?.words[id - 1]?.head ?? -1;
}

for (const name of (args.strategies as string).split(",").map((s) => s.trim())) {
  const base = getStrategy(name);
  const strategy =
    args.unlabeled && "options" in base
      ? headSelection(name, { ...(base as ReturnType<typeof headSelection>).options, labels: false })
      : base;
  const obs: WordObs[] = [];
  const kinds = { decoded: new Map<string, number>(), argmax: new Map<string, number>() };
  const mutual = new Map<string, number>();
  let mutualPairs = 0;
  for (const g of sentences) {
    const r = await strategy.parse({ words: g.words.map((w) => w.form), text: g.text }, clientFor(g));
    const o = observe(g, r);
    currentGold = g;
    for (const x of o) {
      obs.push(x);
      for (const [key, head] of [["decoded", x.head], ["argmax", x.argmax]] as const) {
        const k = errorKind(x, head);
        kinds[key].set(k, (kinds[key].get(k) ?? 0) + 1);
        if (key === "decoded") x.kindDecoded = k;
      }
    }
    // Mutual first-ranked pairs and how the gold tree relates the two words.
    for (const x of o) {
      const y = o[x.argmax - 1];
      if (!y || x.argmax <= x.d || y.argmax !== x.d) continue;
      mutualPairs++;
      const [a, b] = [x, y];
      let label: string;
      if (a.goldHead === b.d) label = `gold ${b.goldUpos} → ${a.goldUpos} (${a.goldRel})`;
      else if (b.goldHead === a.d) label = `gold ${a.goldUpos} → ${b.goldUpos} (${b.goldRel})`;
      else label = "not linked in gold";
      mutual.set(label, (mutual.get(label) ?? 0) + 1);
    }
  }

  const total = obs.length;
  console.log(`\n══ ${name} · ${sentences.length} sentences · ${total} words`);

  console.log("\nHead errors by kind (share of all words)");
  const kindNames = [...new Set([...kinds.decoded.keys(), ...kinds.argmax.keys()])].sort(
    (a, b) => (kinds.decoded.get(b) ?? 0) - (kinds.decoded.get(a) ?? 0),
  );
  printTable(
    ["kind", "decoded", "argmax (before MST)"],
    kindNames.map((k) => [k, pct((kinds.decoded.get(k) ?? 0) / total), pct((kinds.argmax.get(k) ?? 0) / total)]),
  );

  console.log(`\nMutual first-ranked pairs: ${mutualPairs} (${((100 * mutualPairs) / total).toFixed(1)} per 100 words). How gold relates the pair:`);
  printTable(
    ["gold relation between the two words", "pairs", "share"],
    [...mutual.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, c]) => [k, c, pct(c / mutualPairs)]),
  );

  console.log("\nBy gold relation (most frequent first)");
  const byRel = new Map<string, WordObs[]>();
  for (const x of obs) byRel.set(x.goldRel, [...(byRel.get(x.goldRel) ?? []), x]);
  printTable(
    ["gold relation", "words", "head right", "label right | head right", "inverted"],
    [...byRel.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, top)
      .map(([rel, xs]) => {
        const right = xs.filter((x) => x.head === x.goldHead);
        return [
          rel, xs.length, pct(right.length / xs.length),
          right.length ? pct(right.filter((x) => x.rel === rel).length / right.length) : "—",
          pct(xs.filter((x) => x.goldDependents.includes(x.head)).length / xs.length),
        ];
      }),
  );

  console.log("\nDecoded head errors by kind, for the most frequent gold relations (share of that relation's words)");
  const kindCols = ["inverted (took its own dependent)", "too high (took its grandparent)", "sibling (another dependent of its head)", "other"];
  printTable(
    ["gold relation", "words", "right", "inverted", "too high", "sibling", "other", "pred head adjacent"],
    [...byRel.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, top)
      .map(([rel, xs]) => {
        const counts = new Map<string, number>();
        for (const x of xs) {
          counts.set(x.kindDecoded, (counts.get(x.kindDecoded) ?? 0) + 1);
        }
        const wrong = xs.filter((x) => x.head !== x.goldHead);
        return [
          rel, xs.length, pct(xs.filter((x) => x.head === x.goldHead).length / xs.length),
          ...kindCols.map((k) => pct((counts.get(k) ?? 0) / xs.length)),
          wrong.length ? pct(wrong.filter((x) => x.head !== 0 && Math.abs(x.head - x.d) === 1).length / wrong.length) + " of errors" : "—",
        ];
      }),
  );

  console.log("\nOption order (sentence order: the first option is the first word, or the second word for word 1)");
  const isFirst = (x: WordObs, h: number) => h === x.optionOrder[0];
  const byN = [
    { name: "2-5 options", lo: 2, hi: 5 },
    { name: "6-10", lo: 6, hi: 10 },
    { name: "11-20", lo: 11, hi: 20 },
    { name: "21-40", lo: 21, hi: 40 },
    { name: "41+", lo: 41, hi: Infinity },
  ];
  printTable(
    ["options", "words", "top = first option", "gold = first option", "mean p(first)", "head right (argmax)"],
    byN
      .map((b) => ({ b, xs: obs.filter((x) => x.n >= b.lo && x.n <= b.hi) }))
      .filter(({ xs }) => xs.length > 0)
      .map(({ b, xs }) => [
        b.name, xs.length,
        pct(xs.filter((x) => isFirst(x, x.argmax)).length / xs.length),
        pct(xs.filter((x) => isFirst(x, x.goldHead)).length / xs.length),
        (xs.reduce((a, x) => a + x.firstOptionP, 0) / xs.length).toFixed(3),
        pct(xs.filter((x) => x.argmax === x.goldHead).length / xs.length),
      ]),
  );

  console.log("\nArgmax head accuracy by where the gold head sits in the option list (words in sentences of 11+ words)");
  const long = obs.filter((x) => x.n >= 11 && x.goldHead !== 0);
  const posBins = [
    { name: "first 10%", lo: 0, hi: 0.1 },
    { name: "10-30%", lo: 0.1, hi: 0.3 },
    { name: "30-50%", lo: 0.3, hi: 0.5 },
    { name: "50-70%", lo: 0.5, hi: 0.7 },
    { name: "70-90%", lo: 0.7, hi: 0.9 },
    { name: "last 10%", lo: 0.9, hi: 1.01 },
  ];
  const rel = (x: WordObs, h: number) => x.optionOrder.indexOf(h) / Math.max(x.optionOrder.length - 2, 1);
  printTable(
    ["gold head position", "words", "argmax right", "argmax picks in this band"],
    posBins.map((b) => {
      const xs = long.filter((x) => rel(x, x.goldHead) >= b.lo && rel(x, x.goldHead) < b.hi);
      const picks = long.filter((x) => x.argmax !== 0 && rel(x, x.argmax) >= b.lo && rel(x, x.argmax) < b.hi);
      return [b.name, xs.length, xs.length ? pct(xs.filter((x) => x.argmax === x.goldHead).length / xs.length) : "—", picks.length];
    }),
  );

  console.log("\nArgmax head accuracy by distance to the gold head (non-root words)");
  const distBins = [[1, 1], [2, 2], [3, 4], [5, 8], [9, Infinity]] as const;
  printTable(
    ["|gold head − word|", "words", "argmax right", "decoded right", "predicted head at distance 1"],
    distBins.map(([lo, hi]) => {
      const xs = obs.filter((x) => x.goldHead !== 0 && Math.abs(x.goldHead - x.d) >= lo && Math.abs(x.goldHead - x.d) <= hi);
      return [
        hi === Infinity ? `${lo}+` : lo === hi ? `${lo}` : `${lo}-${hi}`, xs.length,
        pct(xs.filter((x) => x.argmax === x.goldHead).length / xs.length),
        pct(xs.filter((x) => x.head === x.goldHead).length / xs.length),
        pct(xs.filter((x) => x.argmax !== 0 && Math.abs(x.argmax - x.d) === 1).length / xs.length),
      ];
    }),
  );

  const posRight = obs.filter((x) => x.predUpos === x.goldUpos);
  const posWrong = obs.filter((x) => x.predUpos !== x.goldUpos);
  console.log(
    `\nHead accuracy when the POS tag is right: ${pct(posRight.filter((x) => x.head === x.goldHead).length / posRight.length)} (${posRight.length} words); when wrong: ${pct(posWrong.filter((x) => x.head === x.goldHead).length / Math.max(posWrong.length, 1))} (${posWrong.length} words)`,
  );
}
