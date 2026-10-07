// bun run explain — one sentence through one strategy, showing exactly how Jev is used: every
// call, an example question and answer exactly as sent and received, every answer in plain words,
// what code did between calls, and the final tree.
//
//   bun run explain "The dog chased a red ball across the yard."
//   bun run explain --id <sent_id>                 a treebank sentence, with ✓/✗ against its answers
//   bun run explain "…" --strategy jev-phrases     any strategy (bun run eval --list shows them)
//   bun run explain "…" --client replay            cached answers only (never calls the API)
//   bun run explain --id <sent_id> --client oracle the gold-tree oracle (a plumbing check)
//   bun run explain "…" --raw                      print every question and answer as raw JSON
//   bun run explain --id <sent_id> --mermaid       just the result, as a Mermaid diagram for Markdown

import { CACHE_DIR } from "../../lab/paths.ts";
import { parseArgs } from "node:util";
import type { CallRecord } from "../../lab/calls.ts";
import { type Gold, goldOf } from "../src/gold.ts";
import { LiveJevClient } from "../../lab/jev/live.ts";
import { MockJevClient } from "../../lab/jev/mock.ts";
import { RecordingJevClient } from "../../lab/jev/recording.ts";
import type { JevClient } from "../../lab/jev/types.ts";
import { oracleClient } from "../src/oracle.ts";
import { QUESTION_SETS } from "../src/question-sets/index.ts";
import { getStrategy, usesJev } from "../src/strategies/index.ts";
import { loadSplit, type Split } from "./data.ts";
import { rowOf } from "./metrics.ts";
import { answerLine, formatAnswerLines, mermaidTree, notScored, renderTree, resolvePaths } from "./render.ts";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    strategy: { type: "string", default: "jev-only" },
    client: { type: "string", default: "record" },
    id: { type: "string" },
    split: { type: "string", default: "dev" },
    raw: { type: "boolean", default: false },
    mermaid: { type: "boolean", default: false },
  },
});

const USD_PER_MTOK = 0.042; // https://docs.typesafe.ai/models.md (checked 2026-10-06)

let gold: Gold | undefined;
let input: string | { words: string[]; text: string };
if (args.id) {
  const g = loadSplit(args.split as Split).find((s) => s.sentId === args.id);
  if (!g) throw new Error(`no sentence ${args.id} in ${args.split}`);
  gold = goldOf(g);
  input = { words: g.words.map((w) => w.form), text: g.text };
} else {
  input = positionals.join(" ") || "The dog chased a red ball across the yard.";
}

const cacheDir = CACHE_DIR;
function client(): JevClient {
  switch (args.client) {
    case "record":
      return new RecordingJevClient(new LiveJevClient(), cacheDir, "record");
    case "replay":
      return new RecordingJevClient(undefined, cacheDir, "replay");
    case "live":
      return new LiveJevClient();
    case "dry":
      return new MockJevClient();
    case "oracle":
      if (!gold) throw new Error("--client oracle needs --id (a treebank sentence)");
      return oracleClient(gold);
    default:
      throw new Error("--client must be record, replay, live, dry or oracle");
  }
}

const strategy = getStrategy(args.strategy as string);
const r = await strategy.parse(input, usesJev(strategy) ? client() : new MockJevClient());
const words = r.tokens.map((t) => t.form);

// --mermaid: just the result as a Mermaid diagram, for pasting into Markdown.
if (args.mermaid) {
  console.log(["```mermaid", ...mermaidTree(r, gold), "```"].join("\n"));
  process.exit(0);
}

const rule = (title: string) => console.log(`\n━━ ${title} ${"━".repeat(Math.max(0, 76 - title.length))}`);
const indent = (lines: string[], n = 3) => lines.map((l) => " ".repeat(n) + l).join("\n");

console.log(`${strategy.name}${strategy.rung !== undefined ? ` (Jev dial ${strategy.rung})` : ""}: ${strategy.summary}`);
console.log(`Sentence: ${r.text}`);
console.log(`Words:    ${words.map((w, i) => `w${i + 1}=${w}`).join("  ")}`);
if (gold) console.log(`Treebank: ${gold.sentId} (✓/✗ compare each answer with the treebank)`);

let lastState = "";
const printSteps = (after: number) => {
  const steps = r.steps.filter((s) => s.afterRequest === after);
  if (steps.length === 0) return;
  rule("Code");
  for (const s of steps) console.log(`   ${s.text}`);
};

printSteps(0);
r.calls.forEach((call, i) => {
  const callNo = new Set(r.calls.slice(0, i + 1).map((c) => c.title)).size;
  const totalCalls = new Set(r.calls.map((c) => c.title)).size;
  const qn = Object.keys(call.request.questions).length;
  const tokens = call.response.usage ? ` · ${call.response.usage.input_tokens.toLocaleString()} input tokens` : "";
  rule(`Call ${callNo} of ${totalCalls}: ${call.title}${call.parts > 1 ? ` (request ${call.part + 1} of ${call.parts})` : ""}`);
  const timing = args.client === "replay" ? "answers from the cache" : `${call.ms.toFixed(0)} ms`;
  console.log(`   ${qn} questions in one request${tokens} · ${timing} · model ${call.response.model}`);
  const state = JSON.stringify(call.request.state);
  if (state !== lastState) {
    console.log(`   State sent (every question in this request reads it):\n${indent(wrapJson(state), 5)}`);
    lastState = state;
  }
  printCall(call);
  printSteps(i + 1);
});

rule("Result");
console.log(indent(renderTree(r, gold)));
const s = r.stats;
const tok = s.inputTokens || Math.round(s.requestChars / 2.5);
console.log(
  `\n   ${r.calls.length} request${r.calls.length === 1 ? "" : "s"} · ${s.questions} questions · ${s.inputTokens ? "" : "≈"}${tok.toLocaleString()} input tokens` +
    ` · ${s.inputTokens ? "" : "≈"}$${((tok * USD_PER_MTOK) / 1e6).toFixed(5)} · ${s.jevMs.toFixed(0)} ms waiting on Jev`,
);
if (gold) {
  const right = r.edges.filter((e, i) => e.head === gold!.words[i]!.head).length;
  console.log(`   Attached right: ${right} of ${words.length} words`);
}

function printCall(call: CallRecord): void {
  // Group the request's questions by question set (and level, for two-level sets), in order.
  const groups = new Map<string, string[]>();
  for (const id of Object.keys(call.request.questions)) {
    const meta = call.meta[id];
    const key = meta?.set ?? "?";
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  const phrases = (call.request.state as { phrases?: Record<string, string> }).phrases;
  for (const [set, ids] of groups) {
    const info = QUESTION_SETS[set];
    const q0 = call.request.questions[ids[0] as string]!;
    const nOpts = (id: string) => {
      const q = call.request.questions[id]!;
      return q.type === "choice" ? Object.keys(q.criteria).length : 2;
    };
    const opts = ids.map(nOpts);
    const optText = Math.min(...opts) === Math.max(...opts) ? `${opts[0]} options each` : `${Math.min(...opts)}–${Math.max(...opts)} options`;
    console.log(`\n   ▸ ${info?.title ?? set}   (${set} · ${ids.length} question${ids.length === 1 ? "" : "s"} · ${q0.type} · ${optText})`);
    const shown = args.raw ? ids : [ids[0] as string];
    for (const id of shown) {
      const q = call.request.questions[id]!;
      console.log(`     ${args.raw ? "" : "Example question, exactly as sent "}(${id}):`);
      console.log(indent(wrap(`instructions: ${String(q.instructions)}`, 92), 7));
      if (q.type === "choice") {
        const entries = Object.entries(q.criteria);
        const limit = args.raw ? entries.length : 4;
        for (const [k, v] of entries.slice(0, limit)) console.log(indent(wrap(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`, 92), 9));
        if (entries.length > limit) console.log(`         … ${entries.length - limit} more options (--raw shows all)`);
      } else if (q.type === "noul" && q.criteria) {
        console.log(indent(wrap(`yes: ${q.criteria.true}  no: ${q.criteria.false}`, 92), 9));
      }
      console.log(indent(wrap(`In plain words: ${resolvePaths(String(q.instructions).split(" Use Universal Dependencies")[0] as string, words, phrases)}`, 92), 7));
      const a = call.response.answers[id];
      const nProbs = a && "probabilities" in a ? Object.keys(a.probabilities).length : 0;
      console.log(`     Its answer, exactly as returned${nProbs > 5 ? ` (top 5 of ${nProbs} probabilities shown)` : ""}:`);
      console.log(indent(wrap(compactAnswer(a), 92), 7));
    }
    // Every answer, one line each. Two-level sets (word type in groups, relationships) show the
    // first-level answer, then "›" and the answer to the second-level question it points to.
    const twoLevel = (id: string) => {
      const level = call.meta[id]?.level;
      return level === "group" || level === "kind";
    };
    const isSecondLevel = (id: string) => {
      const row = call.meta[id] ? rowOf(call.meta[id]!) : "";
      return row.includes("(") && !twoLevel(id);
    };
    const lines = ids
      .filter((id) => !isSecondLevel(id))
      .map((id) => {
        const line = answerLine(id, call.request.questions[id]!, call, words, gold);
        if (!twoLevel(id)) return line;
        // Follow the best path (TypeSafe's tree rule: highest geometric mean of the two answers),
        // which is what the strategy uses; it can differ from the first level's top answer.
        const first = call.response.answers[id];
        const firstProbs = first && "probabilities" in first ? first.probabilities : {};
        let best: { group: string; pg: number; second: string; pf: number; score: number } | undefined;
        for (const [g, pg] of Object.entries(firstProbs)) {
          const q2 = ids.find((x) => call.meta[x]?.word === call.meta[id]?.word && call.meta[x]?.level === g);
          const a2 = q2 ? call.response.answers[q2] : undefined;
          if (!q2 || !a2 || !("probabilities" in a2)) continue;
          const pf = Math.max(...Object.values(a2.probabilities));
          const score = Math.sqrt(pg * pf);
          if (!best || score > best.score) best = { group: g, pg, second: q2, pf, score };
        }
        if (!best) return line;
        const l2 = answerLine(best.second, call.request.questions[best.second]!, call, words, gold);
        const top = l2.ranked[0];
        if (top) {
          line.ranked = [
            { label: `${best.group} ${best.pg.toFixed(2)} › ${top.label}`, p: top.p },
            ...line.ranked.filter((r) => r.label !== best.group),
          ];
        }
        if (gold) line.verdict = twoLevelVerdict(id, best.group, best.second, ids, call);
        return line;
      });
    console.log(`     All answers${gold ? " (treebank: ✓ right, or ✗ and the right answer)" : ""}:`);
    console.log(indent(formatAnswerLines(lines), 7));
  }
}

/** One verdict for a two-level answer: right kind and right specific answer, or what the treebank says. */
function twoLevelVerdict(firstId: string, pickedGroup: string, secondId: string, ids: string[], call: CallRecord): string {
  if (!gold) return "";
  const meta = call.meta[firstId]!;
  const set = QUESTION_SETS[meta.set]!;
  const rightGroup = set.expected(meta, gold);
  if (rightGroup === undefined) return notScored(meta.set);
  const rightSecondId = ids.find((x) => call.meta[x]?.word === meta.word && call.meta[x]?.level === rightGroup);
  const rightSecond = rightSecondId ? set.expected(call.meta[rightSecondId]!, gold) : undefined;
  const picked = call.response.answers[secondId];
  const pickedSecond = picked && "choice" in picked ? picked.choice : undefined;
  if (rightGroup === pickedGroup && rightSecond === pickedSecond) return "✓";
  return `✗ ${String(rightGroup)} › ${String(rightSecond ?? "?")}`;
}

function compactAnswer(a: unknown): string {
  if (!a || typeof a !== "object") return String(a);
  const ans = a as Record<string, unknown>;
  if (ans.probabilities && typeof ans.probabilities === "object") {
    const ranked = Object.entries(ans.probabilities as Record<string, number>).sort((x, y) => y[1] - x[1]);
    const shown = Object.fromEntries(ranked.slice(0, 5).map(([k, p]) => [k, Number(p.toFixed(4))]));
    return JSON.stringify({ ...ans, confidence: Number(Number(ans.confidence).toFixed(4)), probabilities: shown });
  }
  return JSON.stringify(a);
}

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + word.length + 1 > width) {
      out.push(line);
      line = "  " + word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

function wrapJson(json: string): string[] {
  return wrap(json.replace(/,"/g, ', "'), 92);
}
