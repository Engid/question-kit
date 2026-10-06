// bun run eval — score strategies against the treebank and print a report card.
// See docs/evals.md for every option and how to read the output.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { CHARS_PER_TOKEN_ESTIMATE } from "../src/calls.ts";
import { type Gold, goldOf } from "../src/gold.ts";
import { LiveJevClient } from "../src/jev/live.ts";
import { MockJevClient } from "../src/jev/mock.ts";
import { CacheMissError, RecordingJevClient } from "../src/jev/recording.ts";
import type { JevClient } from "../src/jev/types.ts";
import { oracleClient } from "../src/oracle.ts";
import { QUESTION_SETS } from "../src/question-sets/index.ts";
import { ALL, EXPERIMENTS, getStrategy, LINEUP, usesJev } from "../src/strategies/index.ts";
import type { ParseResult, Strategy } from "../src/types.ts";
import type { ConlluSentence } from "../src/ud/conllu.ts";
import { fmtSep } from "../src/result.ts";
import { universalDeprel } from "../src/ud/deprel.ts";
import { BUCKETS, EWT, loadSplit, sample, type Split } from "./data.ts";
import {
  aggregate,
  type AnswerCheck,
  byDistance,
  byRelation,
  calibration,
  checkAnswers,
  predictionOf,
  questionSetRows,
  type SentenceScore,
  scoreSentence,
} from "./metrics.ts";
import { bar, renderTree } from "./render.ts";
import { pct, printTable } from "./table.ts";

/** TypeSafe's listed price for jev-1.13 input tokens; output tokens are free. https://docs.typesafe.ai/models.md (checked 2026-10-06) */
const USD_PER_MTOK = 0.042;

const { values: args } = parseArgs({
  options: {
    strategies: { type: "string" },
    all: { type: "boolean", default: false },
    list: { type: "boolean", default: false },
    split: { type: "string", default: "dev" },
    "per-bucket": { type: "string", default: "25" },
    "max-len": { type: "string" },
    limit: { type: "string" },
    ids: { type: "string" },
    exclude: { type: "string" },
    seed: { type: "string" },
    client: { type: "string", default: "replay" },
    "cache-dir": { type: "string", default: join(import.meta.dir, "..", ".cache", "jev") },
    concurrency: { type: "string", default: "4" },
    label: { type: "string" },
    examples: { type: "string", default: "1" },
    detail: { type: "boolean", default: false },
    unlabeled: { type: "boolean", default: false },
    "no-save": { type: "boolean", default: false },
  },
});

if (args.list) {
  for (const group of ["ladder", "question-design", "experiment", "baseline"] as const) {
    console.log(`\n${group === "ladder" ? "Ladder (rung 0 = all code … 4 = all Jev)" : group === "question-design" ? "Question design" : group === "experiment" ? "Experiments (--all, or by name)" : "Baselines"}`);
    for (const s of ALL.filter((x) => x.group === group)) console.log(`  ${s.rung !== undefined ? `${s.rung} ` : "  "}${s.name.padEnd(30)} ${s.summary}`);
  }
  process.exit(0);
}

// ------------------------------------------------------------------ setup

const root = join(import.meta.dir, "..");
const split = args.split as Split;
const all = loadSplit(split);
const readIds = async (f?: string) => (f ? (await readFile(f, "utf8")).split(/\s+/).filter(Boolean) : undefined);
const ids = await readIds(args.ids);
const sentences = sample(all, {
  perBucket: ids ? undefined : Number(args["per-bucket"]),
  maxLen: args["max-len"] ? Number(args["max-len"]) : undefined,
  limit: args.limit ? Number(args.limit) : undefined,
  ids,
  exclude: await readIds(args.exclude),
  seed: args.seed ? Number(args.seed) : undefined,
});
const golds = new Map<string, Gold>(sentences.map((s) => [s.sentId, goldOf(s)]));

let strategies: Strategy[] = args.strategies
  ? (args.strategies as string).split(",").map((s) => getStrategy(s.trim()))
  : args.all
    ? [...LINEUP, ...EXPERIMENTS]
    : LINEUP;
if (args.unlabeled) strategies = strategies.map((s) => s.unlabeled?.() ?? s);

const mode = args.client as string;
if (!["replay", "record", "live", "oracle", "dry"].includes(mode)) throw new Error(`unknown --client ${mode}`);
const needsJev = strategies.some(usesJev);
const live = needsJev && (mode === "live" || mode === "record") ? new LiveJevClient() : undefined;
const cache = mode === "replay" || mode === "record" ? new RecordingJevClient(live, args["cache-dir"] as string, mode) : undefined;
const dry = new MockJevClient();
const clientFor = (g: ConlluSentence): JevClient =>
  mode === "oracle" ? oracleClient(golds.get(g.sentId)!) : mode === "dry" ? dry : mode === "live" ? (live as JevClient) : (cache as RecordingJevClient);

const words = sentences.reduce((a, s) => a + s.words.length, 0);
const clientText: Record<string, string> = {
  replay: "cached answers only (never calls the API)",
  record: "cache, calling the live API on a miss",
  live: "the live API, no cache",
  oracle: "the gold-tree oracle (a plumbing check, not Jev)",
  dry: "uniform fake answers (sizes only, not Jev)",
};
console.log(`Sample: ${sentences.length} sentences from UD English EWT ${EWT.release} ${split} (${words.toLocaleString()} words)`);
console.log(`Jev answers: ${clientText[mode]}`);
if (args.unlabeled) console.log("--unlabeled: relationship questions skipped, so \"+ relationship\" is not measured.");

// ------------------------------------------------------------------ run

interface Outcome {
  gold: ConlluSentence;
  result?: ParseResult;
  score?: SentenceScore;
  checks?: AnswerCheck[];
  error?: string;
}

async function run(strategy: Strategy): Promise<Outcome[]> {
  const out: Outcome[] = new Array(sentences.length);
  let next = 0;
  const conc = usesJev(strategy) ? Math.max(1, Number(args.concurrency)) : 1;
  await Promise.all(
    Array.from({ length: conc }, async () => {
      while (next < sentences.length) {
        const i = next++;
        const gold = sentences[i] as ConlluSentence;
        try {
          const result = await strategy.parse({ words: gold.words.map((w) => w.form), text: gold.text }, clientFor(gold));
          out[i] = {
            gold,
            result,
            score: scoreSentence(gold, predictionOf(result), result.stats),
            checks: checkAnswers(result.calls, golds.get(gold.sentId)!),
          };
        } catch (err) {
          out[i] = { gold, error: err instanceof CacheMissError ? "cache-miss" : String(err) };
        }
      }
    }),
  );
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
    `  ${s.name.padEnd(30)} ${sentences.length - errs.length}/${sentences.length} parsed in ${((performance.now() - t0) / 1000).toFixed(1)}s` +
      (misses ? ` · ${misses} not in the cache` : "") +
      (other.length ? ` · ${other.length} errors, first: ${other[0]?.error}` : ""),
  );
}

// A strategy with cache misses is left out entirely (rather than shrinking every strategy's sample).
const missing = (s: Strategy) => (outcomes.get(s.name) ?? []).filter((o) => o?.error === "cache-miss").length;
const dropped = strategies.filter((s) => missing(s) > 0 || !outcomes.get(s.name)?.some((o) => o?.score));
if (dropped.length) {
  console.log(`\n  Left out, missing Jev answers for some sentences (run with --client record to fetch them):`);
  for (const s of dropped) console.log(`    ${s.name} (${missing(s)} of ${sentences.length} sentences not in the cache)`);
}
strategies = strategies.filter((s) => !dropped.includes(s));
const common = sentences.filter((_, i) => strategies.every((s) => outcomes.get(s.name)?.[i]?.score));
if (common.length === 0) {
  console.log("\nNothing to score.");
  process.exit(1);
}
if (common.length < sentences.length) console.log(`\n  Scoring the ${common.length} sentences every strategy parsed (of ${sentences.length}).`);
const commonIds = new Set(common.map((s) => s.sentId));
const scored = (name: string) => (outcomes.get(name) ?? []).filter((o) => o.score && commonIds.has(o.gold.sentId));
const scoresOf = (name: string) => scored(name).map((o) => o.score as SentenceScore);

// ------------------------------------------------------------------ report card

const costPer1k = (name: string) => {
  const a = aggregate(scoresOf(name));
  const measured = a.inputTokensPerSentence > 0;
  const tok = measured ? a.inputTokensPerSentence : a.requestCharsPerSentence / CHARS_PER_TOKEN_ESTIMATE;
  return { text: tok === 0 ? "0" : `${measured ? "" : "≈"}${((tok * 1000 * USD_PER_MTOK) / 1e6).toFixed(2)}`, tok };
};

section("Strategies: how often each word is attached to the right word");
printTable(
  ["rung", "strategy", "attached right", "", "right pair", "+ relationship", "word type", "calls", "questions", "$ / 1k sentences"],
  strategies.map((s) => {
    const a = aggregate(scoresOf(s.name));
    const jev = usesJev(s);
    return [
      s.rung !== undefined ? String(s.rung) : s.group === "question-design" ? "q" : "·",
      s.name,
      pct(a.uas),
      bar(a.uas, 20),
      pct(a.pairs),
      args.unlabeled && jev ? "—" : pct(a.las),
      pct(a.upos),
      jev ? a.requestsPerSentence.toFixed(1) : "0",
      jev ? a.questionsPerSentence.toFixed(0) : "0",
      jev ? costPer1k(s.name).text : "0",
    ];
  }),
);
console.log(`  attached right   the word's head (the word it attaches to) matches the treebank
  right pair       the treebank links the two words, in either direction (direction is often a convention)
  + relationship   attached right, and the relationship name matches too
  rung             0 = all code … 4 = all Jev; q = question-design strategies; · = experiments
  $                at $${USD_PER_MTOK} per million input tokens (≈ = estimated from request size)`);

section("Attached right, by sentence length (words)");
const presentBuckets = BUCKETS.filter((b) => common.some((s) => s.words.length >= b.min && s.words.length <= b.max));
printTable(
  ["strategy", ...presentBuckets.map((b) => `${b.name} (${common.filter((s) => s.words.length >= b.min && s.words.length <= b.max).length})`)],
  strategies.map((s) => [s.name, ...presentBuckets.map((b) => pct(aggregate(scoresOf(s.name).filter((x) => x.bucket === b.name)).uas))]),
);

const jevStrategies = strategies.filter(usesJev);
if (jevStrategies.length) {
  section("What Jev was asked: how often its top answer matches the treebank");
  if (mode === "dry" || mode === "oracle") console.log(`  (${clientText[mode]}, so these numbers say nothing about Jev)`);
  for (const s of jevStrategies) {
    console.log(`\n  ${s.name}`);
    const rows = questionSetRows(scored(s.name).flatMap((o) => o.checks ?? []));
    printTable(
      ["question set", "options", "asked", "right answer offered", "top answer right", "≥90% sure", "right when ≥90% sure"],
      rows.map((r) => [r.row, r.meanOptions.toFixed(1), r.questions, pct(r.offered), pct(r.right), pct(r.sure), r.sure ? pct(r.rightWhenSure) : "—"]),
    );
  }
  const used = new Set(jevStrategies.flatMap((s) => questionSetRows(scored(s.name).flatMap((o) => o.checks ?? [])).map((r) => r.row.split(" (")[0] as string)));
  console.log("\n  Question sets:");
  for (const id of used) console.log(`    ${id.padEnd(16)} ${QUESTION_SETS[id]?.title ?? ""}`);
  console.log(`  right answer offered: the treebank's answer was one of the options. It isn't when code's candidates
                        missed it, or a relationship is asked about a word the parse attached wrongly.
  top answer right:     of the questions whose right answer was offered.
  ≥90% sure:            share of those where Jev's top answer had probability ≥ 0.9.
  Two-level questions are scored at the second level only under the treebank's first-level answer.`);
}

// Examples: a few short sentences drawn as trees, for the best Jev strategy.
const nExamples = Number(args.examples);
if (nExamples > 0 && strategies.length) {
  const best = [...(jevStrategies.length ? jevStrategies : strategies)].sort((a, b) => aggregate(scoresOf(b.name)).uas - aggregate(scoresOf(a.name)).uas)[0]!;
  // Representative examples: ordinary-looking sentences of 6–12 words whose score is closest to the
  // strategy's overall score.
  const overall = aggregate(scoresOf(best.name)).uas;
  const picks = scored(best.name)
    .filter((o) => o.gold.words.length >= 6 && o.gold.words.length <= 12 && o.gold.words.every((w) => /^[\p{L}\p{P}']+$/u.test(w.form)))
    .sort((x, y) => Math.abs(x.score!.uas / x.score!.n - overall) - Math.abs(y.score!.uas / y.score!.n - overall))
    .slice(0, nExamples);
  for (const o of picks) {
    section(`Example (${best.name}): ${o.gold.text}`);
    for (const line of renderTree(o.result!, golds.get(o.gold.sentId))) console.log(`  ${line}`);
    console.log(`  See every question and answer: bun run explain --id ${o.gold.sentId} --strategy ${best.name} --client replay`);
  }
}

// ------------------------------------------------------------------ detail

if (args.detail) {
  for (const s of jevStrategies) {
    const sc = scoresOf(s.name);
    const a = aggregate(sc);
    const edges = sc.flatMap((x) => x.edges);
    section(`Detail · ${s.name}`);
    console.log(`  Jev's top answer alone (before the tree builder and cleanup): ${pct(a.argmaxUas)} attached right`);
    console.log(`  Words whose final head differs from Jev's top answer: ${pct(a.argmaxDisagreementRate)}`);
    console.log(`  Pairs of words whose top answers point at each other: ${a.mutualPairsPer100Words.toFixed(1)} per 100 words`);
    console.log(`  Input tokens per sentence: ${costPer1k(s.name).tok.toFixed(0)} · ms waiting on Jev per sentence: ${a.jevMsPerSentence.toFixed(0)}`);
    const cal = calibration(edges);
    console.log(`\n  Is Jev's confidence meaningful? (p = probability of the chosen head; ECE ${cal.ece.toFixed(3)})`);
    printTable(
      ["p", "words", "mean p", "attached right"],
      cal.bins.filter((b) => b.count > 0).map((b) => [`${b.lo.toFixed(1)}–${b.hi.toFixed(1)}`, b.count, b.meanP.toFixed(2), pct(b.accuracy)]),
    );
    console.log("\n  Flagging close calls (top / second < t) as \"check this\":");
    printTable(
      ["t", "flagged", "flag is a real error", "errors caught", "attached right when not flagged"],
      cal.flags.map((f) => [f.threshold, f.flagged, pct(f.precision), pct(f.recall), pct(f.accuracyAbove)]),
    );
    console.log("\n  By distance to the right head:");
    printTable(
      ["distance", "words", "Jev's top answer right", "final answer right"],
      byDistance(edges).map((d) => [d.distance, d.count, pct(d.top), pct(d.final)]),
    );
    console.log("\n  By treebank relationship (most frequent):");
    printTable(
      ["relationship", "words", "attached right", "+ relationship"],
      byRelation(edges).slice(0, 12).map((r) => [r.deprel, r.count, pct(r.uas), pct(r.las)]),
    );
    const worst = scored(s.name).sort((x, y) => x.score!.uas / x.score!.n - y.score!.uas / y.score!.n).slice(0, 2);
    for (const o of worst) {
      console.log(`\n  Worst: ${o.gold.text}  (${o.gold.sentId})`);
      printTable(
        ["#", "word", "treebank", "parse", "p", "top / second"],
        o.gold.words.map((g, i) => {
          const e = o.result!.edges[i]!;
          const ok = e.head === g.head && universalDeprel(e.deprel) === universalDeprel(g.deprel);
          return [g.id, g.form, `${g.head} ${universalDeprel(g.deprel)}`, `${ok ? " " : "✗"} ${e.head} ${e.deprel}`, e.p.toFixed(2), fmtSep(e.separation)];
        }),
      );
    }
  }
}

if (cache) console.log(`\ncache: ${cache.hits} hits, ${cache.misses} misses`);

// ------------------------------------------------------------------ save

if (!args["no-save"]) {
  const models = new Set<string>();
  for (const os of outcomes.values()) for (const o of os) for (const c of o?.result?.calls ?? []) models.add(c.response.model);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const label = args.label ? `-${args.label}` : "";
  const dir = join(root, "results");
  await mkdir(join(dir, "runs"), { recursive: true });
  const runJson = {
    meta: {
      date: new Date().toISOString(),
      treebank: `UD_English-EWT ${EWT.release}`,
      split,
      sample: { perBucket: Number(args["per-bucket"]), maxLen: args["max-len"], limit: args.limit, ids: args.ids, exclude: args.exclude, seed: args.seed },
      client: mode,
      unlabeled: args.unlabeled,
      models: [...models],
      sentences: common.length,
    },
    strategies: Object.fromEntries(
      strategies.map((s) => {
        const sc = scoresOf(s.name);
        return [
          s.name,
          {
            rung: s.rung,
            group: s.group,
            summary: s.summary,
            overall: aggregate(sc),
            buckets: Object.fromEntries(presentBuckets.map((b) => [b.name, aggregate(sc.filter((x) => x.bucket === b.name))])),
            questionSets: questionSetRows(scored(s.name).flatMap((o) => o.checks ?? [])),
            calibration: usesJev(s) ? calibration(sc.flatMap((x) => x.edges)) : null,
            sentences: scored(s.name).map((o) => ({ sentId: o.gold.sentId, text: o.gold.text, n: o.score!.n, uas: o.score!.uas / o.score!.n, las: o.score!.las / o.score!.n, conllu: o.result!.conllu })),
          },
        ];
      }),
    ),
  };
  const runPath = join(dir, "runs", `${stamp}${label}.json`);
  await writeFile(runPath, JSON.stringify(runJson, null, 1));
  await writeFile(join(dir, "runs", `${stamp}${label}.ids`), common.map((s) => s.sentId).join("\n") + "\n");
  for (const s of strategies) {
    const body = scored(s.name).map((o) => `# sent_id = ${o.gold.sentId}\n${o.result!.conllu}`).join("\n");
    await writeFile(join(dir, "runs", `${stamp}${label}.${s.name.replace(/[^\w.-]/g, "_")}.conllu`), body + "\n");
  }
  console.log(`saved ${runPath}`);
}

// ------------------------------------------------------------------ helpers

function section(title: string): void {
  console.log(`\n━━ ${title} ${"━".repeat(Math.max(0, 90 - title.length))}`);
}
