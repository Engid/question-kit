// bun run pizza — score the pizza strategies on Amazon's PIZZA benchmark and print a report card.
//
//   bun run fetch-pizza                         # once: download the orders and the menu
//   bun run pizza                               # the lineup on all 348 dev orders, from the cache
//   bun run pizza --client record               # call Jev for anything not cached yet
//   bun run pizza --all                         # plus the experiments
//   bun run pizza --list                        # every strategy, one line each
//   bun run pizza --client dry --all            # sizes and estimated cost without calling Jev
//   bun run pizza --client oracle               # answers from the answer key (a plumbing check)
//   bun run pizza --split test                  # the 1,357 test orders: use once, for the final numbers
//
// See examples/pizza/README.md for what each column means.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { CHARS_PER_TOKEN_ESTIMATE, type CallRecord, type QuestionMeta } from "../../src/calls.ts";
import { LiveJevClient } from "../../src/jev/live.ts";
import { MockJevClient } from "../../src/jev/mock.ts";
import { CacheMissError, RecordingJevClient } from "../../src/jev/recording.ts";
import type { ChoiceAnswer, JevClient, NoulAnswer } from "../../src/jev/types.ts";
import { bar } from "../../eval/render.ts";
import { pct, printTable } from "../../eval/table.ts";
import { loadPizza, PIZZA, type PizzaRow, type PizzaSplit } from "./data.ts";
import { goldOf, type PizzaGold } from "./gold.ts";
import { pizzaOracle } from "./oracle.ts";
import { describeItem, type Item, itemsFromExr, itemsMatched, sameOrder } from "./order.ts";
import { PIZZA_QUESTION_SETS, pizzaRowOf, WORD_TAG } from "./questions.ts";
import { PIZZA_LIBRARY } from "./library.ts";
import { gatesOf, getPizzaStrategy, PIZZA_ALL, PIZZA_EXPERIMENTS, PIZZA_LINEUP, type PizzaResult, type PizzaStrategy, SURE } from "./strategies.ts";

/** TypeSafe's listed price for jev-1.13 input tokens; output tokens are free. https://docs.typesafe.ai/models.md (checked 2026-10-06) */
const USD_PER_MTOK = 0.042;

const { values: args } = parseArgs({
  options: {
    strategies: { type: "string" },
    all: { type: "boolean", default: false },
    list: { type: "boolean", default: false },
    split: { type: "string", default: "dev" },
    limit: { type: "string" },
    client: { type: "string", default: "replay" },
    "cache-dir": { type: "string", default: join(import.meta.dir, "..", "..", ".cache", "jev") },
    concurrency: { type: "string", default: "4" },
    examples: { type: "string", default: "2" },
    label: { type: "string" },
    "no-save": { type: "boolean", default: false },
  },
});

if (args.list) {
  console.log("\nLadder (rung 0 = all code … 4 = almost all Jev)");
  for (const s of PIZZA_LINEUP) console.log(`  ${s.rung ?? " "} ${s.name.padEnd(36)} ${s.summary}`);
  console.log("\nExperiments (--all, or by name)");
  for (const s of PIZZA_EXPERIMENTS) console.log(`    ${s.name.padEnd(36)} ${s.summary}`);
  console.log("\nThe library, lib/pizza-order-taker (--all, or by name)");
  for (const s of PIZZA_LIBRARY) console.log(`    ${s.name.padEnd(36)} ${s.summary}`);
  process.exit(0);
}

// ------------------------------------------------------------------ setup

const split = args.split as PizzaSplit;
let rows = loadPizza(split);
if (args.limit) rows = rows.slice(0, Number(args.limit));
const golds = new Map<string, PizzaGold>(rows.map((r) => [r.id, goldOf(r)]));

let strategies: PizzaStrategy[] = args.strategies
  ? (args.strategies as string).split(",").map((s) => getPizzaStrategy(s.trim()))
  : args.all
    ? PIZZA_ALL
    : PIZZA_LINEUP;

const mode = args.client as string;
if (!["replay", "record", "live", "oracle", "dry"].includes(mode)) throw new Error(`unknown --client ${mode}`);
const needsJev = strategies.some((s) => s.usesJev);
const live = needsJev && (mode === "live" || mode === "record") ? new LiveJevClient() : undefined;
const cache = mode === "replay" || mode === "record" ? new RecordingJevClient(live, args["cache-dir"] as string, mode) : undefined;
const dry = new MockJevClient();
const clientFor = (row: PizzaRow): JevClient =>
  mode === "oracle" ? pizzaOracle(golds.get(row.id)!) : mode === "dry" ? dry : mode === "live" ? (live as JevClient) : (cache as RecordingJevClient);

const clientText: Record<string, string> = {
  replay: "cached answers only (never calls the API)",
  record: "cache, calling the live API on a miss",
  live: "the live API, no cache",
  oracle: "the answer-key oracle (a plumbing check, not Jev)",
  dry: "uniform fake answers (sizes only, not Jev)",
};
console.log(`Sample: ${rows.length} orders from PIZZA ${split} (${PIZZA.repo}, ${PIZZA.license})`);
console.log(`Jev answers: ${clientText[mode]}`);

// ------------------------------------------------------------------ run

interface Check {
  row: string;
  right: boolean;
  scored: boolean;
  topP: number;
  options: number;
}

interface Outcome {
  row: PizzaRow;
  result?: PizzaResult;
  right?: boolean;
  itemsRight?: number;
  checks?: Check[];
  error?: string;
}

async function run(s: PizzaStrategy): Promise<Outcome[]> {
  const out: Outcome[] = new Array(rows.length);
  let next = 0;
  const conc = s.usesJev ? Math.max(1, Number(args.concurrency)) : 1;
  await Promise.all(
    Array.from({ length: conc }, async () => {
      while (next < rows.length) {
        const i = next++;
        const row = rows[i] as PizzaRow;
        const gold = golds.get(row.id)!;
        try {
          const result = await s.parse({ text: row.text, words: gold.words }, clientFor(row));
          out[i] = {
            row,
            result,
            right: sameOrder(result.exr, row.exr),
            itemsRight: itemsMatched(result.items, gold.items.map((g) => g.item)),
            checks: checkAnswers(result.calls, gold),
          };
        } catch (err) {
          out[i] = { row, error: err instanceof CacheMissError ? "cache-miss" : String(err) };
        }
      }
    }),
  );
  return out;
}

function checkAnswers(calls: CallRecord[], gold: PizzaGold): Check[] {
  const out: Check[] = [];
  for (const call of calls) {
    for (const [id, q] of Object.entries(call.request.questions)) {
      const meta = call.meta[id] as QuestionMeta | undefined;
      const answer = call.response.answers[id];
      const set = meta ? PIZZA_QUESTION_SETS[meta.set] : undefined;
      if (!meta || !answer || !set) continue;
      // Nested word tags: the second-level question under a kind the word isn't can't be right.
      if (meta.set === WORD_TAG && meta.level !== "tag" && meta.level !== "kind") {
        const kind = PIZZA_QUESTION_SETS[WORD_TAG]!.expected({ ...meta, level: "kind" }, gold);
        if (kind !== meta.level) continue;
      }
      const right = set.expected(meta, gold);
      if (q.type === "noul") {
        const p = (answer as NoulAnswer).noul;
        out.push({ row: pizzaRowOf(meta), scored: right !== undefined, right: right !== undefined && p >= 0.5 === right, topP: Math.max(p, 1 - p), options: 2 });
      } else if (q.type === "choice") {
        const probs = (answer as ChoiceAnswer).probabilities;
        const top = Object.entries(probs).sort((a, b) => b[1] - a[1])[0];
        out.push({ row: pizzaRowOf(meta), scored: right !== undefined, right: right !== undefined && top?.[0] === right, topP: top?.[1] ?? 0, options: Object.keys(q.criteria).length });
      }
    }
  }
  return out;
}

const outcomes = new Map<string, Outcome[]>();
console.log("");
for (const s of strategies) {
  const t0 = performance.now();
  const os = await run(s);
  outcomes.set(s.name, os);
  const errs = os.filter((o) => o.error);
  const misses = errs.filter((o) => o.error === "cache-miss").length;
  const other = errs.filter((o) => o.error !== "cache-miss");
  console.log(
    `  ${s.name.padEnd(36)} ${rows.length - errs.length}/${rows.length} done in ${((performance.now() - t0) / 1000).toFixed(1)}s` +
      (misses ? ` · ${misses} not in the cache` : "") +
      (other.length ? ` · ${other.length} errors, first: ${other[0]?.error}` : ""),
  );
}

const missing = (s: PizzaStrategy) => (outcomes.get(s.name) ?? []).filter((o) => o?.error === "cache-miss").length;
const dropped = strategies.filter((s) => missing(s) > 0 || !outcomes.get(s.name)?.some((o) => o?.result));
if (dropped.length) {
  console.log(`\n  Left out, missing Jev answers for some orders (run with --client record to fetch them):`);
  for (const s of dropped) console.log(`    ${s.name} (${missing(s)} of ${rows.length} orders not in the cache)`);
}
strategies = strategies.filter((s) => !dropped.includes(s));
const common = rows.filter((_, i) => strategies.every((s) => outcomes.get(s.name)?.[i]?.result));
if (common.length === 0) {
  console.log("\nNothing to score.");
  process.exit(1);
}
if (common.length < rows.length) console.log(`\n  Scoring the ${common.length} orders every strategy finished (of ${rows.length}).`);
const commonIds = new Set(common.map((r) => r.id));
const scored = (name: string) => (outcomes.get(name) ?? []).filter((o) => o?.result && commonIds.has(o.row.id));

// ------------------------------------------------------------------ report card

const section = (title: string) => console.log(`\n━━ ${title} ${"━".repeat(Math.max(0, 92 - title.length))}`);
const share = (os: Outcome[], f: (o: Outcome) => boolean) => (os.length ? os.filter(f).length / os.length : 0);
const perOrder = (name: string, f: (r: PizzaResult) => number) => {
  const os = scored(name);
  return os.reduce((a, o) => a + f(o.result!), 0) / Math.max(1, os.length);
};
const cost = (name: string) => {
  const tokens = perOrder(name, (r) => r.stats.inputTokens);
  const chars = perOrder(name, (r) => r.stats.requestChars);
  const tok = tokens > 0 ? tokens : chars / CHARS_PER_TOKEN_ESTIMATE;
  return tok === 0 ? "0" : `${tokens > 0 ? "" : "≈"}${((tok * 1000 * USD_PER_MTOK) / 1e6).toFixed(2)}`;
};
const goldItemCount = common.reduce((a, r) => a + golds.get(r.id)!.items.length, 0);

section("Strategies: how often the whole order is right");
const pcfgRight = share(
  common.map((row) => ({ row })),
  (o) => !o.row.pcfgError,
);
printTable(
  ["rung", "strategy", "whole order right", "", "items right", "calls", "questions", "$ / 1k orders"],
  [
    ["ref", "the paper's grammar parser (PCFG)", pct(pcfgRight), bar(pcfgRight, 20), "", "", "", ""],
    ...strategies.map((s) => {
      const os = scored(s.name);
      const right = share(os, (o) => !!o.right);
      return [
        s.rung !== undefined ? String(s.rung) : "·",
        s.name,
        pct(right),
        bar(right, 20),
        pct(os.reduce((a, o) => a + (o.itemsRight ?? 0), 0) / goldItemCount),
        s.usesJev ? perOrder(s.name, (r) => r.stats.requests).toFixed(1) : "0",
        s.usesJev ? perOrder(s.name, (r) => r.stats.questions).toFixed(0) : "0",
        s.usesJev ? cost(s.name) : "0",
      ];
    }),
  ],
);
console.log(`  whole order right  the predicted order equals the answer key, ignoring the order of items and toppings
                     (the paper's "unordered exact match")
  items right        share of the answer key's items (one kind of pizza or drink each) reproduced exactly
  PCFG               the paper's grammar-based parser, from the dataset's own per-order flag
  rung               0 = all code … 4 = almost all Jev; · = experiments and the library
  $                  at $${USD_PER_MTOK} per million input tokens (≈ = estimated from request size)
  For scale, the paper's best model (BART trained on 2.46M synthetic orders) reports 78.6% whole
  order right on the test split.`);

section("Whole order right, by number of items");
const groups: [string, (n: number) => boolean][] = [
  ["1 item", (n) => n === 1],
  ["2 items", (n) => n === 2],
  ["3+ items", (n) => n >= 3],
];
const inGroup = (row: PizzaRow, g: (n: number) => boolean) => g(golds.get(row.id)!.items.length);
printTable(
  ["strategy", ...groups.map(([name, g]) => `${name} (${common.filter((r) => inGroup(r, g)).length})`)],
  strategies.map((s) => [s.name, ...groups.map(([, g]) => pct(share(scored(s.name).filter((o) => inGroup(o.row, g)), (o) => !!o.right)))]),
);

const jevStrategies = strategies.filter((s) => s.usesJev);
if (jevStrategies.length) {
  section("What Jev was asked: how often its top answer matches the answer key");
  if (mode === "dry" || mode === "oracle") console.log(`  (${clientText[mode]}, so these numbers say nothing about Jev)`);
  for (const s of jevStrategies) {
    console.log(`\n  ${s.name}`);
    const checks = scored(s.name).flatMap((o) => o.checks ?? []);
    const byRow = new Map<string, Check[]>();
    for (const c of checks) byRow.set(c.row, [...(byRow.get(c.row) ?? []), c]);
    printTable(
      ["question set", "options", "asked", "scored", "top answer right", "≥90% sure", "right when ≥90% sure"],
      [...byRow.entries()].map(([row, cs]) => {
        const sc = cs.filter((c) => c.scored);
        const sure = sc.filter((c) => c.topP >= SURE);
        return [
          row,
          (cs.reduce((a, c) => a + c.options, 0) / cs.length).toFixed(1),
          cs.length,
          pct(sc.length / cs.length),
          sc.length ? pct(sc.filter((c) => c.right).length / sc.length) : "—",
          sc.length ? pct(sure.length / sc.length) : "—",
          sure.length ? pct(sure.filter((c) => c.right).length / sure.length) : "—",
        ];
      }),
    );
  }
  console.log("\n  Question sets:");
  const used = new Set(jevStrategies.flatMap((s) => scored(s.name).flatMap((o) => (o.checks ?? []).map((c) => c.row.split(" (")[0] as string))));
  for (const id of used) console.log(`    ${id.padEnd(16)} ${PIZZA_QUESTION_SETS[id]?.title ?? ""}`);
  console.log(`  scored:   the answer key says what the right answer is (it doesn't for words like "with", or for
            a part the strategy cut that matches no item).`);

  section("Accept the order as is, or read it back? Each way of deciding, and the mistakes it catches");
  const gateRows: (string | number)[][] = [];
  for (const s of jevStrategies) {
    const os = scored(s.name);
    const names = [...new Set(os.flatMap((o) => Object.keys(gatesOf(o.result!))))];
    for (const [i, g] of names.entries()) {
      const accepted = os.filter((o) => gatesOf(o.result!)[g]);
      const flagged = os.filter((o) => !gatesOf(o.result!)[g]);
      const wrong = os.filter((o) => !o.right);
      const caught = flagged.filter((o) => !o.right).length;
      gateRows.push([
        i === 0 ? s.name : "",
        g,
        pct(accepted.length / os.length),
        accepted.length ? pct(share(accepted, (o) => !!o.right)) : "—",
        `${caught} of ${wrong.length}`,
        flagged.length ? pct(caught / flagged.length) : "—",
      ]);
    }
  }
  printTable(["strategy", "accept as is when", "accepted", "right among accepted", "wrong orders caught", "read-backs that were wrong"], gateRows);
  console.log(`  accepted                    orders an app would take without reading them back
  wrong orders caught         wrong orders that would be read back to the customer instead (the rest slip through)
  read-backs that were wrong  of the orders read back, how many were actually wrong (the rest were right all along)
  every answer ≥ ${SURE}          Jev's top answer was at least ${SURE} likely for every answer the order was built from
  check                       P(wrong) from the order-check questions: the whole order in one question, or the
                              worst of one question per item and one for "anything missing?"`);
}

// Examples: wrong orders from the best Jev strategy (or the baseline).
const nExamples = Number(args.examples);
if (nExamples > 0) {
  const pool = jevStrategies.length ? jevStrategies : strategies;
  const best = [...pool].sort((a, b) => share(scored(b.name), (o) => !!o.right) - share(scored(a.name), (o) => !!o.right))[0];
  if (best) {
    const wrong = scored(best.name).filter((o) => !o.right).slice(0, nExamples);
    for (const o of wrong) {
      section(`Wrong (${best.name}): ${o.row.text}`);
      const show = (items: Item[]) => (items.length ? items.map(describeItem).join("  |  ") : "(nothing)");
      console.log(`  got:  ${show(o.result!.items)}`);
      console.log(`  want: ${show(itemsFromExr(o.row.exr))}`);
      console.log(`  See every question and answer: bun run pizza:explain --id ${o.row.id} --strategy ${best.name} --client replay`);
    }
  }
}

if (cache) console.log(`\ncache: ${cache.hits} hits, ${cache.misses} misses`);

// ------------------------------------------------------------------ save

if (!args["no-save"]) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(import.meta.dir, "..", "..", "results", "pizza");
  await mkdir(dir, { recursive: true });
  const models = new Set<string>();
  for (const os of outcomes.values()) for (const o of os) for (const c of o?.result?.calls ?? []) models.add(c.response.model);
  const path = join(dir, `${stamp}${args.label ? `-${args.label}` : ""}.json`);
  await writeFile(
    path,
    JSON.stringify(
      {
        meta: { date: new Date().toISOString(), dataset: `${PIZZA.repo}@${PIZZA.commit}`, split, client: mode, models: [...models], orders: common.length },
        strategies: Object.fromEntries(
          strategies.map((s) => [
            s.name,
            {
              rung: s.rung,
              summary: s.summary,
              right: share(scored(s.name), (o) => !!o.right),
              orders: scored(s.name).map((o) => ({
                id: o.row.id,
                text: o.row.text,
                right: o.right,
                exr: o.result!.exr,
                gold: o.row.exr,
                confidence: o.result!.confidence,
                ...(o.result!.check ? { check: o.result!.check } : {}),
                ...(o.result!.agreed !== undefined ? { agreed: o.result!.agreed, pick: o.result!.pick } : {}),
              })),
            },
          ]),
        ),
      },
      null,
      1,
    ),
  );
  console.log(`saved ${path}`);
}
