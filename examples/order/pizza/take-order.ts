// bun run order:pizza — take one pizza order with packages/order and the pizza menu, and show what it did.
//
//   bun run order:pizza "two large pizzas with extra cheese and no onions and a diet coke"
//   bun run order:pizza "…" --design every-word        # or pick
//   bun run order:pizza "…" --replay                    # cached answers only (never calls the API)
//
// Needs TYPESAFE_API_KEY in .env, unless every answer is cached.

import { join } from "node:path";
import { parseArgs } from "node:util";
import { type Design, type JevClient, takeOrder } from "@question-kit/order";
import { cachedJev } from "question-kit/cache";
import { typesafeJev } from "question-kit/typesafe";
import { pizzaMenu } from "./menu.ts";

/** A plain-text table: a header, a rule under each column, then the rows (numbers right-aligned). */
function formatTable(header: string[], rows: string[][]): string[] {
  const cells = [header, ...rows];
  const width = (s: string) => Bun.stringWidth(s);
  const widths = header.map((_, c) => Math.max(...cells.map((r) => width(r[c] ?? ""))));
  const isNum = (s: string) => /\d/.test(s) && /^[-\d.,%]+$/.test(s);
  const pad = (s: string, w: number, right: boolean) => (right ? " ".repeat(Math.max(0, w - width(s))) + s : s + " ".repeat(Math.max(0, w - width(s))));
  const line = (r: string[]) => ("  " + r.map((s, c) => pad(s, widths[c] ?? 0, c > 0 && isNum(s))).join("  ")).trimEnd();
  return [line(header), "  " + widths.map((w) => "─".repeat(w)).join("  "), ...rows.map(line)];
}

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    design: { type: "string", default: "gaps" },
    replay: { type: "boolean", default: false },
    "read-back-at": { type: "string", default: "0.3" },
  },
});

const text = positionals.join(" ") || "two large pizzas with extra cheese and no onions and a diet coke";
const cacheDir = join(import.meta.dir, "..", "..", "..", ".cache", "jev");
// @question-kit/order has its own copy of the request and answer types until it's rebuilt on question-kit;
// the requests and answers are the same.
const jev = (args.replay ? cachedJev(undefined, cacheDir, { mode: "replay" }) : cachedJev(typesafeJev(), cacheDir)) as unknown as JevClient;
const readBackAt = Number(args["read-back-at"]);

const r = await takeOrder(text, pizzaMenu(), jev, { design: args.design as Design, readBackAt });

console.log(`\nCustomer: ${text}\n`);
console.log(
  formatTable(
    ["word", "read as", "by", "p"],
    r.words.map((w) => [w.word, w.tag, w.by, w.p !== undefined ? w.p.toFixed(2) : ""]),
  ).join("\n"),
);
console.log(`\nOrder:`);
r.readBack.forEach((line, k) => console.log(`  ${k + 1}. ${line}${r.check ? `   (check: P(wrong) ${r.check.items[k]!.toFixed(2)})` : ""}`));
if (!r.items.length) console.log("  (nothing ordered)");
if (r.check) console.log(`  anything missing? P = ${r.check.missing.toFixed(2)} · whole order wrong? P = ${r.check.whole.toFixed(2)}`);
if (r.pick) console.log(`  designs ${r.pick.agreed ? "agreed" : `disagreed; Jev picked ${r.pick.choice} (p ${r.pick.p?.toFixed(2)})`}`);
console.log(
  r.accept
    ? `\nAccept as is: every check answer is under ${readBackAt}.`
    : `\nRead back: ${[...r.confirm.items.map((k) => `"${r.readBack[k - 1]}"`), ...(r.confirm.missing ? ["anything else?"] : [])].join(", ")}`,
);
const tokens = r.calls.reduce((a, c) => a + (c.response.usage?.input_tokens ?? 0), 0);
console.log(`${r.calls.length} Jev request${r.calls.length === 1 ? "" : "s"} · ${tokens.toLocaleString()} input tokens · $${((tokens * 0.042) / 1e6).toFixed(5)}`);
