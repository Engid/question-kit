// bun run pizza:explain — one order through one pizza strategy: every Jev call, an example question
// and answer exactly as sent and received, every answer in a table, what code did, and the result.
//
//   bun run pizza:explain "two large pizzas with extra cheese and a coke"
//   bun run pizza:explain --id dev-17                     an order from the dataset: answers get ✓ / ✗
//   bun run pizza:explain --id dev-17 --strategy jev-tags-words
//   bun run pizza:explain "…" --client replay             cached answers only (never calls the API)
//   bun run pizza:explain "…" --raw                       every question and answer as raw JSON

import { CACHE_DIR } from "../lab/paths.ts";
import { parseArgs } from "node:util";
import type { CallRecord, QuestionMeta } from "../lab/calls.ts";
import { LiveJevClient } from "../lab/jev/live.ts";
import { MockJevClient } from "../lab/jev/mock.ts";
import { RecordingJevClient } from "../lab/jev/recording.ts";
import type { Answer, JevClient } from "../lab/jev/types.ts";
import { bar } from "../parsing/eval/render.ts";
import { formatTable } from "../lab/table.ts";
import { loadPizza, type PizzaSplit } from "./data.ts";
import { goldOf, type PizzaGold } from "./gold.ts";
import { entryOfTag, idOf, loadMenu } from "./menu.ts";
import { pizzaOracle } from "./oracle.ts";
import { describeItem, itemsFromExr, sameOrder } from "./order.ts";
import { ITEM_START, ITEM_STYLE, ITEM_TOPPING, ORDER_CHECK, ORDER_PICK, PIZZA_QUESTION_SETS, WORD_TAG, WORD_TAG_FOLLOW_UP } from "./questions.ts";
import { gatesOf, getPizzaStrategy } from "./strategies.ts";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    strategy: { type: "string", default: "code-splits-jev-fills" },
    client: { type: "string", default: "record" },
    id: { type: "string" },
    split: { type: "string", default: "dev" },
    raw: { type: "boolean", default: false },
  },
});

let gold: PizzaGold | undefined;
let text: string;
if (args.id) {
  const row = loadPizza((args.id.split("-")[0] ?? args.split) as PizzaSplit).find((r) => r.id === args.id);
  if (!row) throw new Error(`no order ${args.id}`);
  gold = goldOf(row);
  text = row.text;
} else {
  text = positionals.join(" ") || "two large pizzas with extra cheese and no onions and a diet coke";
}
const words = text.split(" ").filter(Boolean);

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
      if (!gold) throw new Error("--client oracle needs --id (an order from the dataset)");
      return pizzaOracle(gold);
    default:
      throw new Error("--client must be record, replay, live, dry or oracle");
  }
}

const strategy = getPizzaStrategy(args.strategy as string);
const r = await strategy.parse({ text, words }, strategy.usesJev ? client() : new MockJevClient());
const menu = loadMenu();

const rule = (title: string) => console.log(`\n━━ ${title} ${"━".repeat(Math.max(0, 76 - title.length))}`);
const indent = (lines: string[], n = 3) => lines.map((l) => " ".repeat(n) + l).join("\n");
const wrap = (s: string, width = 92): string[] => {
  const out: string[] = [];
  let line = "";
  for (const w of s.split(" ")) {
    if (line && line.length + w.length + 1 > width) {
      out.push(line);
      line = `  ${w}`;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
};

console.log(`${strategy.name}${strategy.rung !== undefined ? ` (Jev dial ${strategy.rung})` : ""}: ${strategy.summary}`);
console.log(`Order:  ${text}`);
console.log(`Words:  ${words.map((w, i) => `w${i + 1}=${w}`).join("  ")}`);
if (gold) console.log(`Answer key (${gold.row.id}): ${gold.items.map((g) => describeItem(g.item)).join("  |  ")}`);

const printSteps = (after: number) => {
  const steps = r.steps.filter((s) => s.afterRequest === after);
  if (!steps.length) return;
  rule("Code");
  for (const s of steps) console.log(indent(wrap(s.text, 90)));
};

let lastState = "";
printSteps(0);
r.calls.forEach((call, i) => {
  const qn = Object.keys(call.request.questions).length;
  const tokens = call.response.usage?.input_tokens ? ` · ${call.response.usage.input_tokens.toLocaleString()} input tokens` : "";
  rule(`Call: ${call.title}${call.parts > 1 ? ` (request ${call.part + 1} of ${call.parts})` : ""}`);
  console.log(`   ${qn} questions in one request${tokens} · ${args.client === "replay" ? "answers from the cache" : `${call.ms.toFixed(0)} ms`} · model ${call.response.model}`);
  const state = JSON.stringify(call.request.state);
  if (state !== lastState) {
    console.log(`   State sent (every question in this request reads it):\n${indent(wrap(state.replace(/,"/g, ', "')), 5)}`);
    lastState = state;
  }
  printCall(call);
  printSteps(i + 1);
});

rule("Result");
console.log(`   ${r.items.length ? r.items.map(describeItem).join("\n   ") : "(nothing ordered)"}`);
console.log(indent(wrap(`EXR: ${r.exr}`), 3));
if (gold) console.log(`   ${sameOrder(r.exr, gold.row.exr) ? "✓ matches the answer key" : `✗ the answer key is: ${itemsFromExr(gold.row.exr).map(describeItem).join("  |  ")}`}`);
if (r.confidence !== undefined) console.log(`   Least sure answer used: ${r.confidence.toFixed(2)}`);
if (r.check) console.log(`   Order check, P(wrong): whole order ${r.check.whole.toFixed(2)} · worst of each item and "anything missing?" ${r.check.parts.toFixed(2)}`);
if (r.agreed !== undefined) console.log(`   ${r.agreed ? "The two designs built the same order." : `The two designs disagreed; Jev picked ${r.pick?.choice} (p ${r.pick?.p.toFixed(2)}).`}`);
const gates = Object.entries(gatesOf(r));
if (gates.length) console.log(`   Accept as is, or read back?\n${gates.map(([g, ok]) => `     ${ok ? "accept   " : "read back"}  when ${g}`).join("\n")}`);
console.log(`   ${r.stats.requests} request${r.stats.requests === 1 ? "" : "s"} · ${r.stats.questions} questions · ${r.stats.jevMs.toFixed(0)} ms waiting on Jev`);

// ------------------------------------------------------------------ one call

function label(meta: QuestionMeta, option: string): string {
  if (meta.set === ORDER_PICK || meta.set === ORDER_CHECK) return option;
  if (meta.set === WORD_TAG || meta.set === WORD_TAG_FOLLOW_UP) {
    const e = entryOfTag(option, menu);
    return e ? `${e.slot}: ${e.label}` : option;
  }
  if (meta.set === ITEM_TOPPING || meta.set === ITEM_STYLE || meta.set === "item-kind" || meta.set === "item-number") return option;
  const slot = meta.set.replace("item-", "") as "size" | "drink" | "container" | "volume";
  return menu.bySlot[slot]?.find((e) => idOf(e.entity) === option)?.label ?? option;
}

function subject(meta: QuestionMeta): string {
  if (meta.word !== undefined) return `"${words[meta.word - 1]}"`;
  if (meta.set === ORDER_PICK) return "which order";
  if (meta.set === ORDER_CHECK) return meta.level === "whole" ? "whole order wrong?" : meta.level === "missing" ? "anything missing?" : `item ${meta.item} wrong?`;
  const e = meta.entity ? (meta.set === ITEM_TOPPING ? menu.get("topping", meta.entity) : menu.get("style", meta.entity)) : undefined;
  return `item ${meta.item}${e ? ` · ${e.label}` : ""}`;
}

function ranked(a: Answer | undefined, meta: QuestionMeta): { label: string; p: number }[] {
  if (!a) return [];
  if ("noul" in a && typeof a.noul === "number") return [{ label: "yes", p: a.noul }, { label: "no", p: 1 - a.noul }].sort((x, y) => y.p - x.p);
  if ("probabilities" in a) return Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]).map(([o, p]) => ({ label: label(meta, o), p }));
  return [];
}

function printCall(call: CallRecord): void {
  const groups = new Map<string, string[]>();
  for (const id of Object.keys(call.request.questions)) {
    const set = call.meta[id]?.set ?? "?";
    groups.set(set, [...(groups.get(set) ?? []), id]);
  }
  for (const [set, ids] of groups) {
    const q0 = call.request.questions[ids[0] as string]!;
    const nOpts = q0.type === "choice" ? Object.keys(q0.criteria).length : 2;
    console.log(`\n   ▸ ${PIZZA_QUESTION_SETS[set]?.title ?? set}   (${set} · ${ids.length} question${ids.length === 1 ? "" : "s"} · ${q0.type} · ${nOpts} options)`);
    for (const id of args.raw ? ids : [ids[0] as string]) {
      const q = call.request.questions[id]!;
      console.log(`     ${args.raw ? "" : "Example question, exactly as sent "}(${id}):`);
      console.log(indent(wrap(`instructions: ${String(q.instructions)}`), 7));
      if (q.type === "choice") {
        const entries = Object.entries(q.criteria);
        const limit = args.raw ? entries.length : 4;
        for (const [k, v] of entries.slice(0, limit)) console.log(indent(wrap(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`), 9));
        if (entries.length > limit) console.log(`         … ${entries.length - limit} more options (--raw shows all)`);
      } else if (q.type === "noul" && q.criteria) console.log(indent(wrap(`yes: ${q.criteria.true}  no: ${q.criteria.false}`), 9));
      const a = call.response.answers[id];
      console.log(`     Its answer, exactly as returned:`);
      console.log(indent(wrap(compact(a)), 7));
    }
    // The table: one row per question. For the per-topping and per-style questions, only the rows
    // where Jev or the answer key says something other than "not mentioned".
    const rows: (string | number)[][] = [];
    let hidden = 0;
    let hiddenWrong = 0;
    for (const id of ids) {
      const meta = call.meta[id] as QuestionMeta;
      const rk = ranked(call.response.answers[id], meta);
      const right = gold ? PIZZA_QUESTION_SETS[meta.set]?.expected(meta, gold) : undefined;
      const rightLabel = right === undefined ? undefined : typeof right === "boolean" ? (right ? "yes" : "no") : label(meta, right);
      const top = rk[0];
      if ((meta.set === ITEM_TOPPING || meta.set === ITEM_STYLE) && top?.label === "no" && (rightLabel === undefined || rightLabel === "no")) {
        hidden++;
        continue;
      }
      if (meta.set === ITEM_START && top?.label === "no" && rightLabel !== "yes") {
        hidden++;
        continue;
      }
      if (meta.set === WORD_TAG && meta.level !== "tag" && meta.level !== "kind" && (top?.p ?? 0) < 0.5) {
        hidden++;
        continue;
      }
      const verdict = rightLabel === undefined ? "" : top?.label === rightLabel ? "✓" : `✗ ${rightLabel}`;
      if (verdict.startsWith("✗") && hidden) hiddenWrong += 0;
      const others = rk.slice(1, 3).filter((x) => x.p >= 0.005).map((x) => `${x.label} ${x.p.toFixed(2)}`).join(" · ");
      rows.push([subject(meta), top?.label ?? "(no answer)", top ? top.p.toFixed(2) : "", top ? bar(top.p, 10) : "", others, verdict]);
    }
    const header = ["about", "Jev's answer", "p", "", "runners-up", "answer key"];
    const keep = header.map((_, c) => c < 4 || rows.some((row) => row[c] !== ""));
    const pick = <T,>(xs: T[]) => xs.filter((_, c) => keep[c]);
    console.log(`     All answers${hidden ? ` (${hidden} more answered "no"/"not mentioned"${gold ? ", matching the answer key" : ""}, not shown)` : ""}:`);
    if (rows.length) console.log(indent(formatTable(pick(header), rows.map(pick), 0), 7));
    void hiddenWrong;
  }
}

function compact(a: Answer | undefined): string {
  if (!a) return "(no answer)";
  if ("probabilities" in a) {
    const top5 = Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]).slice(0, 5);
    return JSON.stringify({ ...a, probabilities: Object.fromEntries(top5.map(([k, p]) => [k, Number(p.toFixed(4))])) });
  }
  return JSON.stringify(a);
}
