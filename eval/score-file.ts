// Score a CoNLL-U file of predictions (e.g. a trained parser's output from baselines/) against the
// gold split with the same metrics as `bun run eval`. Sentences are matched by sent_id when the
// prediction file has them, otherwise by order; word counts must match (gold tokenization).
//
//   bun run eval:score baselines/out/stanza-dev.conllu [--split dev] [--name stanza] [--ids FILE]

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parseConllu } from "../src/ud/conllu.ts";
import { BUCKETS, loadSplit, type Split } from "./data.ts";
import { aggregate, scoreSentence, type SentenceScore } from "./metrics.ts";
import { pct, printTable } from "./table.ts";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: { split: { type: "string", default: "dev" }, name: { type: "string" }, ids: { type: "string" } },
});
const file = positionals[0];
if (!file) throw new Error("usage: bun run eval:score <predictions.conllu> [--split dev] [--ids FILE]");

const gold = loadSplit(args.split as Split);
const pred = parseConllu(readFileSync(file, "utf8"));
const byId = new Map(pred.filter((s) => s.sentId).map((s) => [s.sentId, s]));
const want = args.ids ? new Set(readFileSync(args.ids, "utf8").split(/\s+/).filter(Boolean)) : undefined;

const scores: SentenceScore[] = [];
let skipped = 0;
gold.forEach((g, i) => {
  if (want && !want.has(g.sentId)) return;
  const p = byId.get(g.sentId) ?? (byId.size === 0 ? pred[i] : undefined);
  if (!p || p.words.length !== g.words.length) {
    skipped++;
    return;
  }
  scores.push(
    scoreSentence(g, { upos: p.words.map((w) => w.upos), heads: p.words.map((w) => w.head), deprels: p.words.map((w) => w.deprel) }),
  );
});

const name = args.name ?? file;
const a = aggregate(scores);
console.log(`${name} on ${args.split}: ${scores.length} sentences scored${skipped ? `, ${skipped} skipped (missing or different word count)` : ""}\n`);
printTable(["system", "sents", "words", "UPOS", "UAS", "LAS"], [[name, a.sentences, a.words, pct(a.upos), pct(a.uas), pct(a.las)]]);
console.log("");
printTable(
  ["system", ...BUCKETS.map((b) => b.name)],
  [[name, ...BUCKETS.map((b) => {
    const x = aggregate(scores.filter((s) => s.bucket === b.name));
    return x.words ? `${pct(x.uas)} / ${pct(x.las)}` : "—";
  })]],
);
