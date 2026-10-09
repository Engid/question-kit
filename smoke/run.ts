// bun run smoke — run the core methods' small hand-written cases against Jev.
//
//   bun run smoke                         # from the answer cache (free; misses are reported)
//   bun run smoke --client dry            # no Jev: requests and estimated cost only
//   bun run smoke --client record         # call Jev for anything not cached yet
//   bun run smoke --only extractDate,pickOne --verbose

import { join } from "node:path";
import { parseArgs } from "node:util";
import { type Answer, estimateCost, estimateTokens, fakeJev, type SystemOneCall, type SystemOneClient, type Question } from "question-kit";
import { CacheMissError, type CachedJev, cachedJev } from "question-kit/cache";
import { typesafeJev } from "question-kit/typesafe";
import { CASES } from "./cases.ts";

const CACHE_DIR = join(import.meta.dir, "..", ".cache", "jev");

/** For a dry run: every option equally likely, every yes/no at 0.5. */
function uniform(q: Question): Answer {
  if (q.type === "noul") return { type: "noul", noul: 0.5 };
  const keys = q.type === "choice" ? Object.keys(q.criteria) : q.criteria.map((_, i) => String(i));
  const probabilities = Object.fromEntries(keys.map((k) => [k, 1 / keys.length]));
  if (q.type === "choice") return { type: "choice", choice: keys[0] ?? "", confidence: 0, probabilities };
  return { type: "score", score: (keys.length - 1) / 2, confidence: 0, probabilities };
}

const { values: args } = parseArgs({
  options: {
    client: { type: "string", default: "replay" },
    only: { type: "string" },
    verbose: { type: "boolean", default: false },
  },
});
const mode = args.client!;
if (!["replay", "record", "live", "dry"].includes(mode)) throw new Error(`unknown --client ${mode}`);
const live = mode === "record" || mode === "live" ? typesafeJev() : undefined;
const cached: CachedJev | undefined = mode === "replay" || mode === "record" ? cachedJev(live, CACHE_DIR, { mode: mode as "replay" | "record" }) : undefined;
const client: SystemOneClient = mode === "dry" ? fakeJev((_, q) => uniform(q)) : (cached ?? live!);
const only = args.only ? new Set(args.only.split(",")) : undefined;
const cases = CASES.filter((c) => !only || only.has(c.method));

console.log(`core methods: ${cases.length} cases · answers from ${mode === "dry" ? "nowhere (dry run: sizes and cost only)" : mode}\n`);
const byMethod = new Map<string, { pass: number; fail: number; missing: number; calls: number; tokens: number }>();
const allLog: SystemOneCall[] = [];
for (const c of cases) {
  const log: SystemOneCall[] = [];
  const m = byMethod.get(c.method) ?? { pass: 0, fail: 0, missing: 0, calls: 0, tokens: 0 };
  byMethod.set(c.method, m);
  let line: string;
  try {
    const result = await c.run(client, log);
    const verdict = mode === "dry" ? true : c.check(result);
    if (verdict === true) {
      m.pass++;
      line = mode === "dry" ? "  ·   " : "  ok  ";
    } else {
      m.fail++;
      line = `  FAIL  (${verdict})`;
    }
    if (args.verbose) line += `\n        ${JSON.stringify(result).slice(0, 400)}`;
  } catch (err) {
    if (err instanceof CacheMissError) {
      m.missing++;
      line = "  --   (not in the cache; run with --client record)";
    } else throw err;
  }
  const tokens = log.reduce((s, x) => s + (x.response.usage?.input_tokens || estimateTokens(x.request.state, x.request.questions)), 0);
  m.calls += log.length;
  m.tokens += tokens;
  allLog.push(...log);
  console.log(`${line.startsWith("  FAIL") ? "✗" : line.startsWith("  --") ? "?" : "✓"} ${c.method.padEnd(16)} ${c.name.slice(0, 60).padEnd(60)}${line}`);
}

console.log("\nmethod            right   requests   tokens");
for (const [name, m] of byMethod) {
  const total = m.pass + m.fail;
  console.log(`  ${name.padEnd(16)} ${mode === "dry" ? "  -  " : `${m.pass}/${total}`.padStart(5)}   ${String(m.calls).padStart(8)}   ${Math.round(m.tokens).toString().padStart(6)}${m.missing ? `   (${m.missing} not cached)` : ""}`);
}
const tokens = [...byMethod.values()].reduce((s, m) => s + m.tokens, 0);
console.log(`\n${allLog.length} requests, about ${Math.round(tokens).toLocaleString()} input tokens, about $${estimateCost(allLog).toFixed(4)} at $0.042 per million`);
if (cached) console.log(`cache: ${cached.stats.hits} hits, ${cached.stats.misses} misses`);
