// One sentence through a strategy, with the answers printed: the first thing to run against the
// live API. Responses are cached like `--client record`, so re-running it is free.
//
//   bun run smoke "The dog chased a red ball across the yard."   # head-selection, live + cache
//   bun run smoke "..." --strategy head-selection:pos-hier
//   bun run smoke "..." --client dry|replay|live

import { join } from "node:path";
import { parseArgs } from "node:util";
import { LiveJevClient } from "../src/jev/live.ts";
import { MockJevClient } from "../src/jev/mock.ts";
import { RecordingJevClient } from "../src/jev/recording.ts";
import type { JevClient } from "../src/jev/types.ts";
import { fmtSep } from "../src/strategies/common.ts";
import { getStrategy } from "../src/strategies/registry.ts";
import { printTable } from "./table.ts";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    strategy: { type: "string", default: "head-selection" },
    client: { type: "string", default: "record" },
  },
});
const text = positionals.join(" ") || "The dog chased a red ball across the yard.";
if (!["record", "replay", "live", "dry"].includes(args.client as string)) throw new Error("--client must be record, replay, live or dry");
const cacheDir = join(import.meta.dir, "..", ".cache", "jev");
const client: JevClient =
  args.client === "dry"
    ? new MockJevClient()
    : args.client === "live"
      ? new LiveJevClient()
      : new RecordingJevClient(args.client === "record" ? new LiveJevClient() : undefined, cacheDir, args.client === "record" ? "record" : "replay");

const strategy = getStrategy(args.strategy as string);
const r = await strategy.parse(text, client);

console.log(`${strategy.name}: ${strategy.description}\n${r.text}\n`);
for (const t of r.trace) {
  console.log(`request "${t.stage}": ${Object.keys(t.request.questions).length} questions, ${(JSON.stringify(t.request).length / 1000).toFixed(1)} KB, ${t.ms.toFixed(0)} ms, model ${t.response.model}, usage ${JSON.stringify(t.response.usage ?? null)}`);
}
console.log("");
const top3 = (d: Record<string, number>, label: (k: string) => string) =>
  Object.entries(d).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, p]) => `${label(k)} ${p.toFixed(2)}`).join(", ");
printTable(
  ["#", "word", "UPOS (top 3)", "head (top 3)", "→ decoded", "p", "sep", "relation (top 3)"],
  r.tokens.map((t, i) => {
    const e = r.edges[i]!;
    const name = (k: string) => (k === "0" ? "root" : `${k}:${r.tokens[Number(k) - 1]?.form ?? "?"}`);
    return [
      t.id, t.form, top3(t.uposDist, (k) => k) || t.upos,
      top3(e.headDist, name) || "—",
      `${name(String(e.head))}${e.head !== e.argmaxHead ? " (≠ argmax)" : ""}`,
      e.p.toFixed(2), fmtSep(e.separation),
      e.deprelDist ? top3(e.deprelDist, (k) => k) : e.deprel,
    ];
  }),
);
console.log(`\n${r.conllu}`);
