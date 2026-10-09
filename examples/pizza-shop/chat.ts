// bun run pizza — order at the counter of a made-up pizza shop, with Jev's thinking shown beside the chat.
//
//   bun run pizza              type as the customer; an empty line leaves
//   bun run pizza --trace      also print every question Jev was asked, with its top answers
//   bun run pizza --quiet      the chat only
//   bun run pizza --replay     cached answers only (never calls the API)
//   bun run pizza --fake       no Jev at all: a rule-of-thumb stand-in (fake.ts), to see the screen without a key
//
// Needs TYPESAFE_API_KEY in .env, unless every answer is cached or --fake. Each kind of line has its own
// mark and color: what Jev read (dim, with a ┊ margin), what the register did (⚙), what the agent
// said (bold), and the order so far (a box).

import { join } from "node:path";
import { parseArgs } from "node:util";
import { type AgentEvent, defaultTemplates, type Phrase, turn, type TurnResult } from "question-kit/service-agent";
import { type ChoiceAnswer, estimateCost, type Question, type SystemOneCall } from "question-kit";
import { CacheMissError, cachedJev } from "question-kit/cache";
import { typesafeJev } from "question-kit/typesafe";
import { fakeShopClient } from "./fake.ts";
import { priceOf } from "./menu.ts";
import { Register } from "./register.ts";
import { shop, wording } from "./shop.ts";

const { values: args } = parseArgs({ options: { trace: { type: "boolean", default: false }, quiet: { type: "boolean", default: false }, replay: { type: "boolean", default: false }, fake: { type: "boolean", default: false } } });
const cacheDir = join(import.meta.dir, "..", "..", ".cache", "jev");
const client = args.fake ? fakeShopClient() : args.replay ? cachedJev(undefined, cacheDir, { mode: "replay" }) : cachedJev(typesafeJev(), cacheDir);
const calls: SystemOneCall[] = [];
const opts = { client, calls, templates: { ...defaultTemplates, ...wording } };

// Colors: Jev dim magenta, the register cyan, the agent bold, the order yellow.
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string, s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const jev = (s: string) => paint("2;35", ` ┊ Jev  ${s}`);
const register = (s: string) => paint("36", ` ⚙ Register  ${s}`);
const agent = (s: string) => paint("1", ` Agent  ${s}`);
const dim = (s: string) => paint("2", s);
const mark = (outcome: string) => (outcome === "act" ? "✓" : outcome === "unsure" ? "?" : "–");
const p = (x: number) => x.toFixed(2);

/** One line per thing Jev read, from the events a turn added. */
function explain(events: AgentEvent[]): string[] {
  const out: string[] = [];
  const after: string[] = [];
  const phrase = (ph: Phrase) => {
    const what = ph.tool === null ? "nothing" : `${shop.tools[ph.tool]?.name?.toLowerCase() ?? ph.tool}${ph.record ? ` line ${ph.record}` : ""}`;
    return `"${ph.text}" → ${what}${ph.readBack ? ` (${ph.readBack.join(", ")})` : ""}  ${p(ph.confidence)} ${mark(ph.outcome)}`;
  };
  for (const e of events) {
    if (e.type === "read-intent") out.push(jev(`intent → ${e.value ?? "none"}  ${p(e.confidence)} ${mark(e.outcome)}`));
    else if (e.type === "read-aside" && (e.value || args.trace)) out.push(jev(`aside → ${e.value ?? "none"}  ${p(e.confidence)} ${mark(e.outcome)}`));
    else if (e.type === "read-repeat") for (const ph of e.phrases) out.push(jev(phrase(ph)));
    else if (e.type === "read-yes-no") (e.about === "finished" ? after : out).push(jev(`${e.about === "finished" ? "done ordering" : e.about === "right" ? "order right" : e.about === "more" ? "anything else" : e.about === "fixed" ? "fixed" : `is it ${e.checked}`}? → ${e.value ? "yes" : "no"}  ${p(e.confidence)} ${mark(e.outcome)}`));
    else if (e.type === "read-review") {
      const worst = Math.max(e.missing, ...e.wrong.map((w) => w.p));
      out.push(jev(`check → ${e.doubt ? "something looks wrong: read it back" : "nothing looks wrong"}  P(wrong) ${worst <= 0.005 ? "≤ 0.01" : p(worst)}${e.doubt ? ` (${[...e.wrong.filter((w) => w.p >= shop.readBackAt).map((w) => `"${w.text}" ${p(w.p)}`), ...(e.missing >= shop.readBackAt ? [`missing ${p(e.missing)}`] : [])].join(", ")})` : ""}`));
    }
    else if (e.type === "read-slot" && e.outcome === "skip" && e.confidence === 1) out.push(paint("2", ` ┊ code  ${shop.slots[e.slot]?.label ?? e.slot} → nothing that looks like one`));
    else if (e.type === "read-slot") out.push(jev(`${shop.slots[e.slot]?.label ?? e.slot} → ${e.value ?? "none"}  ${p(e.confidence)} ${mark(e.outcome)}`));
    else if (e.type === "read-confirm") out.push(jev(`go ahead? → ${e.answer}  ${p(e.confidence)} ${mark(e.outcome)}`));
    else if (e.type === "read-policy") out.push(jev(`next step → ${e.value ?? "none"}  ${p(e.confidence)} ${mark(e.outcome)}`));
  }
  return [...out, ...after];
}

/** --trace: each question in a request, with its top answers as bars. */
function trace(call: SystemOneCall): string[] {
  const out = [dim(`   ┌ request: ${call.title || "?"} · ${Object.keys(call.request.questions).length} questions · ${call.ms.toFixed(0)} ms`)];
  const bar = (x: number) => "█".repeat(Math.round(x * 10)).padEnd(10, "░");
  const text = (q: Question) => (typeof q.instructions === "string" ? q.instructions : JSON.stringify(q.instructions)).replace(/\s+/g, " ").slice(0, 110);
  for (const [id, q] of Object.entries(call.request.questions)) {
    out.push(dim(`   │ ${id}: ${text(q)}`));
    const a = call.response.answers[id];
    if (!a) continue;
    if ("noul" in a) out.push(dim(`   │   ${bar(a.noul)} ${p(a.noul)} yes`));
    else {
      const ranked = Object.entries((a as ChoiceAnswer).probabilities).sort((x, y) => y[1] - x[1]).slice(0, 3).filter(([, v], i) => i === 0 || v >= 0.01);
      for (const [k, v] of ranked) out.push(dim(`   │   ${bar(v)} ${p(v)} ${k}`));
    }
  }
  out.push(dim("   └"));
  return out;
}

function orderBox(reg: Register): string[] {
  if (!reg.lines.length) return [];
  const lines = reg.lines.map((l, k) => ({ n: `${k + 1}`, text: reg.readBack([l.item])[0]!, price: `$${priceOf(l.item).toFixed(2)}` }));
  lines.push({ n: "", text: "Total", price: `$${reg.total().toFixed(2)}` });
  const width = Math.max(30, ...lines.map((l) => 3 + Bun.stringWidth(l.text) + 2 + l.price.length));
  const row = (l: (typeof lines)[number]) => `│ ${l.n.padEnd(2)} ${l.text}${" ".repeat(width - 3 - Bun.stringWidth(l.text) - l.price.length)}${l.price} │`;
  const title = reg.orderNumber ? ` Order #${reg.orderNumber} ` : " Order ";
  return [`┌${title}${"─".repeat(width + 2 - title.length)}┐`, ...lines.map(row), `└${"─".repeat(width + 2)}┘`].map((l) => paint("33", ` ${l}`));
}

/** The menu in a box, each line wrapped at 72 columns with the turn-overs indented. */
function menuBox(lines: string[]): string[] {
  const wrapped: string[] = [];
  for (const line of lines) {
    let cur = "";
    for (const word of line.split(" ")) {
      if (cur && Bun.stringWidth(`${cur} ${word}`) > 72) {
        wrapped.push(cur);
        cur = `   ${word}`;
      } else cur = cur ? `${cur} ${word}` : word;
    }
    wrapped.push(cur);
  }
  const width = Math.max(...wrapped.map((l) => Bun.stringWidth(l)));
  return ["", `┌ Menu ${"─".repeat(width - 4)}┐`, ...wrapped.map((l) => `│ ${l}${" ".repeat(width - Bun.stringWidth(l))} │`), `└${"─".repeat(width + 2)}┘`].map((l) => paint("33", ` ${l}`));
}

const reg = new Register();
let log: AgentEvent[] = [];
let seen = 0;
console.log(`\nA made-up pizza counter. Type as the customer; an empty line leaves.${args.quiet ? "" : " Jev's reads are the dim ┊ lines; the register's work is marked ⚙."}`);
if (args.fake) console.log(paint("33", " (--fake: a rule-of-thumb stand-in is answering, not Jev)"));
console.log();
process.stdout.write(" You    ");
for await (const line of console) {
  const text = line.trim();
  if (!text) break;
  const said: string[] = [];
  const before = JSON.stringify([reg.lines, reg.orderNumber]);
  reg.newMessage();
  const show = (r: TurnResult) => {
    if (!args.quiet) {
      if (args.trace) for (const c of calls.slice(seen)) console.log(trace(c).join("\n"));
      seen = calls.length;
      for (const l of explain(r.log.slice(log.length))) console.log(l);
    }
    log = r.log;
    said.push(...r.messages);
  };
  let r: TurnResult;
  try {
    console.log();
    r = await turn(shop, log, { type: "customer", text }, opts);
    show(r);
    while (r.action.type === "call") {
      const result = reg.run(r.action.tool, r.action.values);
      if (!args.quiet) console.log(register(`${r.action.tool}: ${result.did}`));
      if (r.action.tool === "show-menu") for (const l of menuBox(result.data as string[])) console.log(l);
      const { did: _did, ...rest } = result;
      r = await turn(shop, r.log, { type: "result", tool: r.action.tool, step: r.action.step, ...rest }, opts);
      show(r);
    }
  } catch (err) {
    if (!(err instanceof CacheMissError)) throw err;
    console.log("\n(That answer isn't cached: run without --replay to ask Jev.)");
    break;
  }
  console.log(`\n${agent(said.join(" "))}`);
  if (JSON.stringify([reg.lines, reg.orderNumber]) !== before) for (const l of ["", ...orderBox(reg)]) console.log(l);
  if (r.view.ended) {
    console.log(`\n(${r.view.ended.how === "done" ? "finished" : `handed off: ${r.view.ended.reason}`})`);
    break;
  }
  process.stdout.write("\n You    ");
}
console.log(dim(`\n${calls.length} requests${args.fake ? " (to the stand-in)" : " to Jev"}, about $${estimateCost(calls).toFixed(4)}${args.fake ? " if Jev had answered" : " (cached answers included)"}.`));
