// bun run order:pizza — take one pizza order with packages/order-kit and the pizza menu, and show what it did.
//
//   bun run order:pizza "two large pizzas with extra cheese and no onions and a diet coke"
//   bun run order:pizza "…" --design every-word        # or pick
//   bun run order:pizza "…" --replay                    # cached answers only (never calls the API)
//
// Needs the menu (bun run fetch-pizza) and, unless every answer is cached, TYPESAFE_API_KEY in .env.

import { CACHE_DIR } from "../../../research/lab/paths.ts";
import { parseArgs } from "node:util";
import { LiveJevClient } from "../../../research/lab/jev/live.ts";
import { RecordingJevClient } from "../../../research/lab/jev/recording.ts";
import { type Design, takeOrder } from "@question-kit/order-kit";
import { formatTable } from "../../../research/lab/table.ts";
import { pizzaMenu } from "./menu.ts";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    design: { type: "string", default: "gaps" },
    replay: { type: "boolean", default: false },
    "read-back-at": { type: "string", default: "0.3" },
  },
});

const text = positionals.join(" ") || "two large pizzas with extra cheese and no onions and a diet coke";
const cacheDir = CACHE_DIR;
const jev = args.replay ? new RecordingJevClient(undefined, cacheDir, "replay") : new RecordingJevClient(new LiveJevClient(), cacheDir, "record");
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
