// bun run eval [options]
//
//   --strategies a,b,c   strategies to run (default: head-selection,rules,adjacent)
//   --split dev|test     treebank split (default: dev)
//   --per-bucket N       sentences per length bucket (default: 10)
//   --max-len N          skip sentences longer than N words
//   --limit N            cap the total sample
//   --ids FILE           a file of sent_ids to run instead of a sample
//   --exclude FILE       leave out these sent_ids (e.g. an earlier run's .ids file, for a held-out sample)
//   --seed N             sampling seed (default 20261006)
//   --client MODE        replay (default): cached Jev responses only, never calls the API
//                        record: use the cache, call the live API on a miss and save the answer
//                        live: call the API, no cache
//                        oracle: answer from the gold tree (a plumbing check, not a model)
//                        dry: uniform answers, no network: shows question counts and request sizes
//   --concurrency N      sentences in flight at once (default: 4)
//   --label NAME         name for the saved run
//   --worst N            worst sentences to print per Jev strategy (default: 3)
//   --unlabeled          head-selection strategies skip the relation questions (UAS only; lets
//                        decode-only variants be scored on cached head answers for free)
//   --no-save            don't write results/

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { LiveJevClient } from "../src/jev/live.ts";
import { MockJevClient } from "../src/jev/mock.ts";
import { oracleClient } from "../src/jev/oracle.ts";
import { CacheMissError, RecordingJevClient } from "../src/jev/recording.ts";
import type { JevClient } from "../src/jev/types.ts";
import { CHARS_PER_TOKEN_ESTIMATE, fmtSep, isJudged } from "../src/strategies/common.ts";
import { headSelection } from "../src/strategies/head-selection/index.ts";
import { getStrategy, OFFLINE_STRATEGIES } from "../src/strategies/registry.ts";

/** TypeSafe's listed price for jev-1.13 input tokens; output tokens are free. Check before quoting. */
const USD_PER_MTOK = 0.042;
import type { ParseResult } from "../src/types.ts";
import type { ConlluSentence } from "../src/ud/conllu.ts";
import { universalDeprel } from "../src/ud/deprel.ts";
import { BUCKETS, EWT, loadSplit, sample, type Split } from "./data.ts";
import { aggregate, byRelation, calibration, predictionOf, type SentenceScore, scoreSentence } from "./metrics.ts";
import { pct, printTable } from "./table.ts";

const { values: args } = parseArgs({
  options: {
    strategies: { type: "string", default: "head-selection,rules,adjacent" },
    split: { type: "string", default: "dev" },
    "per-bucket": { type: "string", default: "10" },
    "max-len": { type: "string" },
    limit: { type: "string" },
    ids: { type: "string" },
    exclude: { type: "string" },
    seed: { type: "string" },
    client: { type: "string", default: "replay" },
    "cache-dir": { type: "string", default: join(import.meta.dir, "..", ".cache", "jev") },
    concurrency: { type: "string", default: "4" },
    label: { type: "string" },
    worst: { type: "string", default: "3" },
    "no-save": { type: "boolean", default: false },
    unlabeled: { type: "boolean", default: false },
  },
});

const root = join(import.meta.dir, "..");
const split = args.split as Split;
const all = loadSplit(split);
const ids = args.ids ? (await readFile(args.ids, "utf8")).split(/\s+/).filter(Boolean) : undefined;
const sentences = sample(all, {
  perBucket: ids ? undefined : Number(args["per-bucket"]),
  maxLen: args["max-len"] ? Number(args["max-len"]) : undefined,
  limit: args.limit ? Number(args.limit) : undefined,
  ids,
  exclude: args.exclude ? (await readFile(args.exclude, "utf8")).split(/\s+/).filter(Boolean) : undefined,
  seed: args.seed ? Number(args.seed) : undefined,
});
const strategies = (args.strategies as string).split(",").map((s) => {
  const base = getStrategy(s.trim());
  if (!args.unlabeled || !("options" in base)) return base;
  const opts = (base as ReturnType<typeof headSelection>).options;
  return headSelection(`${base.name}`, { ...opts, labels: false });
});
if (args.unlabeled) console.log("--unlabeled: relation questions skipped; LAS is not meaningful in this run.");
const mode = args.client as string;

if (!["replay", "record", "live", "oracle", "dry"].includes(mode)) throw new Error(`unknown --client ${mode}`);
const needsJev = strategies.some((s) => !OFFLINE_STRATEGIES.has(s.name));
// Build shared clients up front so a missing API key fails before any work starts.
const live = needsJev && (mode === "live" || mode === "record") ? new LiveJevClient() : undefined;
const cache =
  mode === "replay" || mode === "record" ? new RecordingJevClient(live, args["cache-dir"] as string, mode) : undefined;
const dry = new MockJevClient();
function clientFor(gold: ConlluSentence): JevClient {
  if (mode === "oracle") return oracleClient(gold.words);
  if (mode === "dry") return dry;
  if (mode === "live") return live as JevClient;
  return cache as RecordingJevClient;
}

console.log(`UD English EWT ${EWT.release} ${split}: ${sentences.length} of ${all.length} sentences · client: ${mode}\n`);

interface Outcome {
  gold: ConlluSentence;
  result?: ParseResult;
  score?: SentenceScore;
  error?: string;
}

async function runStrategy(name: string): Promise<Outcome[]> {
  const strategy = strategies.find((s) => s.name === name) ?? getStrategy(name);
  const out: Outcome[] = new Array(sentences.length);
  let next = 0;
  const conc = OFFLINE_STRATEGIES.has(name) ? 1 : Math.max(1, Number(args.concurrency));
  await Promise.all(
    Array.from({ length: conc }, async () => {
      while (next < sentences.length) {
        const i = next++;
        const gold = sentences[i] as ConlluSentence;
        try {
          const result = await strategy.parse({ words: gold.words.map((w) => w.form), text: gold.text }, clientFor(gold));
          out[i] = { gold, result, score: scoreSentence(gold, predictionOf(result), result.stats) };
        } catch (err) {
          out[i] = { gold, error: err instanceof CacheMissError ? "cache-miss" : String(err) };
        }
      }
    }),
  );
  return out;
}

const outcomes = new Map<string, Outcome[]>();
for (const s of strategies) {
  const t0 = performance.now();
  outcomes.set(s.name, await runStrategy(s.name));
  const errs = outcomes.get(s.name)!.filter((o) => o.error);
  const misses = errs.filter((o) => o.error === "cache-miss").length;
  console.log(
    `${s.name}: ${sentences.length - errs.length}/${sentences.length} parsed in ${((performance.now() - t0) / 1000).toFixed(1)}s` +
      (misses ? ` · ${misses} not in the cache (run with --client record)` : "") +
      (errs.length - misses ? ` · ${errs.length - misses} errors, first: ${errs.find((o) => o.error !== "cache-miss")?.error}` : ""),
  );
}

// Strategies that parsed nothing (e.g. replay with an empty cache) are reported and left out.
const dropped = strategies.filter((s) => !outcomes.get(s.name)?.some((o) => o?.score));
for (const s of dropped) console.log(`\n⚠ ${s.name} parsed no sentences and is left out of the tables.`);
strategies.splice(0, strategies.length, ...strategies.filter((s) => !dropped.includes(s)));
// Compare the rest on the same sentences: those all of them parsed.
const common = sentences.filter((_, i) => strategies.every((s) => outcomes.get(s.name)?.[i]?.score));
if (common.length < sentences.length) {
  console.log(`\n⚠ Scoring the ${common.length} sentences every strategy parsed (of ${sentences.length}).`);
}
if (common.length === 0) {
  console.log("Nothing to score.");
  process.exit(1);
}
const commonIds = new Set(common.map((s) => s.sentId));
const scoresOf = (name: string) =>
  (outcomes.get(name) ?? []).filter((o) => o.score && commonIds.has(o.gold.sentId)).map((o) => o.score as SentenceScore);

console.log("\nOverall");
printTable(
  ["strategy", "sents", "words", "UPOS", "UAS", "LAS"],
  strategies.map((s) => {
    const a = aggregate(scoresOf(s.name));
    const unlabeled = args.unlabeled && !OFFLINE_STRATEGIES.has(s.name);
    return [s.name, a.sentences, a.words, pct(a.upos), pct(a.uas), unlabeled ? "—" : pct(a.las)];
  }),
);

const jevNames = strategies.filter((s) => !OFFLINE_STRATEGIES.has(s.name)).map((s) => s.name);
if (jevNames.length) {
  console.log(`\nJev diagnostics and cost (input tokens: measured when the API reported usage, else ≈ request chars / ${CHARS_PER_TOKEN_ESTIMATE})`);
  printTable(
    ["strategy", "argmax UAS", "MST changed", "mutual pairs/100w", "req/sent", "q/sent", "in tok/sent", "Jev ms/sent", `$ per 1k sents`],
    jevNames.map((name) => {
      const a = aggregate(scoresOf(name));
      const measured = a.inputTokensPerSentence > 0;
      const tok = measured ? a.inputTokensPerSentence : a.requestCharsPerSentence / CHARS_PER_TOKEN_ESTIMATE;
      return [
        name, pct(a.argmaxUas), pct(a.argmaxDisagreementRate), a.mutualPairsPer100Words.toFixed(1),
        a.requestsPerSentence.toFixed(1), a.questionsPerSentence.toFixed(0),
        `${measured ? "" : "≈"}${tok.toFixed(0)}`, a.jevMsPerSentence.toFixed(0),
        `${measured ? "" : "≈"}${((tok * 1000 * USD_PER_MTOK) / 1e6).toFixed(2)}`,
      ];
    }),
  );
  console.log(`  price: $${USD_PER_MTOK}/M input tokens, output free (https://docs.typesafe.ai/models.md, checked 2026-10-06)`);
}

console.log("\nUAS / LAS by sentence length (words)");
const presentBuckets = BUCKETS.filter((b) => common.some((s) => s.words.length >= b.min && s.words.length <= b.max));
printTable(
  ["strategy", ...presentBuckets.map((b) => `${b.name} (n=${common.filter((s) => s.words.length >= b.min && s.words.length <= b.max).length})`)],
  strategies.map((s) => {
    const sc = scoresOf(s.name);
    return [s.name, ...presentBuckets.map((b) => {
      const a = aggregate(sc.filter((x) => x.bucket === b.name));
      return args.unlabeled && !OFFLINE_STRATEGIES.has(s.name) ? pct(a.uas) : `${pct(a.uas)} / ${pct(a.las)}`;
    })];
  }),
);

const jevStrategies = strategies.filter((s) => !OFFLINE_STRATEGIES.has(s.name));
for (const s of jevStrategies) {
  const cal = calibration(scoresOf(s.name).flatMap((x) => x.edges));
  console.log(`\nCalibration · ${s.name} (p = Jev's probability for the decoded head; ECE ${cal.ece.toFixed(3)})`);
  printTable(
    ["p bin", "edges", "mean p", "head accuracy"],
    cal.bins.filter((b) => b.count > 0).map((b) => [`${b.lo.toFixed(1)}–${b.hi.toFixed(1)}`, b.count, b.meanP.toFixed(2), pct(b.accuracy)]),
  );
  printTable(
    ["flag if separation <", "flagged", "precision (flag is wrong)", "recall (wrong caught)", "accuracy of unflagged"],
    cal.flags.map((f) => [f.threshold, f.flagged, pct(f.precision), pct(f.recall), pct(f.accuracyAbove)]),
  );
}

const worstN = Number(args.worst);
for (const s of jevStrategies.length ? jevStrategies : strategies.slice(0, 1)) {
  const worst = (outcomes.get(s.name) ?? [])
    .filter((o) => o.score && o.result && commonIds.has(o.gold.sentId))
    .sort((a, b) => a.score!.las / a.score!.n - b.score!.las / b.score!.n)
    .slice(0, worstN);
  for (const o of worst) {
    console.log(`\nWorst · ${s.name} · ${o.gold.sentId} · LAS ${pct(o.score!.las / o.score!.n)}\n  ${o.gold.text}`);
    const r = o.result!;
    printTable(
      ["#", "word", "gold", "pred", "p", "sep"],
      o.gold.words.map((g, i) => {
        const e = r.edges[i]!;
        const ok = e.head === g.head && universalDeprel(e.deprel) === universalDeprel(g.deprel);
        return [
          g.id, g.form,
          `${g.head} ${universalDeprel(g.deprel)}`,
          `${ok ? " " : "✗"} ${e.head} ${e.deprel}`,
          isJudged(e) ? e.p.toFixed(2) : "",
          isJudged(e) ? fmtSep(e.separation) : "",
        ];
      }),
    );
  }
}

if (cache) console.log(`\ncache: ${cache.hits} hits, ${cache.misses} misses`);

if (!args["no-save"]) {
  const models = new Set<string>();
  for (const os of outcomes.values()) for (const o of os) for (const t of o?.result?.trace ?? []) models.add(t.response.model);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const label = args.label ? `-${args.label}` : "";
  const run = {
    meta: {
      date: new Date().toISOString(),
      treebank: `UD_English-EWT ${EWT.release}`,
      split,
      sample: { perBucket: Number(args["per-bucket"]), maxLen: args["max-len"], limit: args.limit, ids: args.ids, exclude: args.exclude, seed: args.seed },
      unlabeled: args.unlabeled,
      client: mode,
      models: [...models],
      sentences: common.length,
    },
    strategies: Object.fromEntries(
      strategies.map((s) => {
        const sc = scoresOf(s.name);
        return [
          s.name,
          {
            description: s.description,
            overall: aggregate(sc),
            buckets: Object.fromEntries(presentBuckets.map((b) => [b.name, aggregate(sc.filter((x) => x.bucket === b.name))])),
            calibration: OFFLINE_STRATEGIES.has(s.name) ? null : calibration(sc.flatMap((x) => x.edges)),
            byRelation: byRelation(sc.flatMap((x) => x.edges)),
            sentences: (outcomes.get(s.name) ?? [])
              .filter((o) => o.score && commonIds.has(o.gold.sentId))
              .map((o) => ({
                sentId: o.gold.sentId,
                text: o.gold.text,
                n: o.score!.n,
                uas: o.score!.uas / o.score!.n,
                las: o.score!.las / o.score!.n,
                conllu: o.result!.conllu,
              })),
          },
        ];
      }),
    ),
  };
  const dir = join(root, "results");
  await mkdir(join(dir, "runs"), { recursive: true });
  const runPath = join(dir, "runs", `${stamp}${label}.json`);
  await writeFile(runPath, JSON.stringify(run, null, 1));
  await writeFile(join(dir, "runs", `${stamp}${label}.ids`), common.map((s) => s.sentId).join("\n") + "\n");
  // One CoNLL-U file per strategy, with sent_ids, for `bun run eval:score` or the official CoNLL 2018 script.
  for (const s of strategies) {
    const body = (outcomes.get(s.name) ?? [])
      .filter((o) => o.result && commonIds.has(o.gold.sentId))
      .map((o) => `# sent_id = ${o.gold.sentId}\n${o.result!.conllu}`)
      .join("\n");
    await writeFile(join(dir, "runs", `${stamp}${label}.${s.name.replace(/[^\w.-]/g, "_")}.conllu`), body + "\n");
  }
  const real = mode !== "oracle" && mode !== "dry";
  if (real) await writeFile(join(dir, "latest.json"), JSON.stringify(run, null, 1));
  console.log(`\nsaved ${runPath}${real ? " and results/latest.json" : ""}`);
}
