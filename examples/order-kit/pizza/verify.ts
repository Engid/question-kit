// bun run order:pizza:verify — does the pizza order taker (packages/order-kit with menu.ts) do exactly
// what the pizza experiment measured?
//
// Runs each order-kit design next to the experiment's design it packages, on every order of a
// split, and compares them order by order: the requests sent to Jev (byte for byte), the order
// built, and the check's probabilities. With --client replay (the default) it never calls Jev: the
// order taker's requests must be the experiment's, or the cache has no answer for them and the
// order counts as a mismatch.
//
//   bun run order:pizza:verify                      # dev, from the cache
//   bun run order:pizza:verify --split test
//   bun run order:pizza:verify --client live        # ask Jev again (order-kit only, ~$0.50 on dev):
//                                                     how much do its answers vary from run to run?
//   bun run order:pizza:verify --only order-kit,order-kit/pick

import { CACHE_DIR } from "../../../research/lab/paths.ts";
import { parseArgs } from "node:util";
import { LiveJevClient } from "../../../research/lab/jev/live.ts";
import { CacheMissError, RecordingJevClient } from "../../../research/lab/jev/recording.ts";
import type { JevClient } from "../../../research/lab/jev/types.ts";
import { loadPizza, type PizzaSplit } from "../../../research/pizza/data.ts";
import { goldOf } from "../../../research/pizza/gold.ts";
import { sameOrder } from "../../../research/pizza/order.ts";
import { getPizzaStrategy, type PizzaResult } from "../../../research/pizza/strategies.ts";

const { values: args } = parseArgs({
  options: {
    split: { type: "string", default: "dev" },
    client: { type: "string", default: "replay" },
    limit: { type: "string" },
    only: { type: "string" },
  },
});

const ALL_PAIRS: [experiment: string, orderTaker: string][] = [
  ["keywords-jev-fills-gaps+check", "order-kit"],
  ["jev-tags-words+check", "order-kit/every-word"],
  ["pick-dial-1-or-3", "order-kit/pick"],
];
// Asking Jev again costs money, so a live run checks only the default design unless told otherwise.
const only = args.only ? args.only.split(",") : args.client === "replay" ? undefined : ["order-kit"];
const PAIRS = ALL_PAIRS.filter(([, lib]) => !only || only.includes(lib));

const cacheDir = CACHE_DIR;
const replay = new RecordingJevClient(undefined, cacheDir, "replay");
// The experiment's side always comes from the cache. The order taker's too, unless --client live asks Jev again.
const libraryClient: JevClient = args.client === "live" ? new LiveJevClient() : args.client === "record" ? new RecordingJevClient(new LiveJevClient(), cacheDir, "record") : replay;

let rows = loadPizza(args.split as PizzaSplit);
if (args.limit) rows = rows.slice(0, Number(args.limit));
console.log(`PIZZA ${args.split}: ${rows.length} orders · the experiment's answers from the cache · the order taker's from ${args.client === "live" ? "the live API (asked again)" : args.client}`);

const requests = (r: PizzaResult) => r.calls.map((c) => JSON.stringify({ state: c.request.state, questions: c.request.questions }));

for (const [labName, libName] of PAIRS) {
  const lab = getPizzaStrategy(labName);
  const lib = getPizzaStrategy(libName);
  let same = 0;
  let sameRequests = 0;
  let missing = 0;
  let orderDiffers = 0;
  let checkDiffers = 0;
  let maxCheckGap = 0;
  let labRight = 0;
  // Answer by answer, for requests both sides sent: did the top answer change, and by how much did probabilities move?
  let answersCompared = 0;
  let topFlips = 0;
  let maxDelta = 0;
  let sumDelta = 0;
  let libRight = 0;
  const examples: string[] = [];
  for (const row of rows) {
    const input = { text: row.text, words: goldOf(row).words };
    let a: PizzaResult;
    try {
      a = await lab.parse(input, replay);
    } catch (e) {
      if (e instanceof CacheMissError) {
        missing++;
        continue;
      }
      throw e;
    }
    let b: PizzaResult;
    try {
      b = await lib.parse(input, libraryClient);
    } catch (e) {
      if (!(e instanceof CacheMissError)) throw e;
      missing++;
      if (examples.length < 3) examples.push(`${row.id}: the order taker asked something the experiment never did (not in the cache)`);
      continue;
    }
    if (sameOrder(a.exr, row.exr)) labRight++;
    if (sameOrder(b.exr, row.exr)) libRight++;
    // The order taker's pick design adds the check; compare the requests the experiment made.
    const ra = requests(a);
    const rb = requests(b).slice(0, ra.length);
    const reqSame = ra.length === rb.length && ra.every((x, i) => x === rb[i]);
    const orderSame = sameOrder(a.exr, b.exr);
    const gap = a.check && b.check ? Math.max(Math.abs(a.check.whole - b.check.whole), Math.abs(a.check.parts - b.check.parts)) : 0;
    maxCheckGap = Math.max(maxCheckGap, gap);
    if (reqSame) sameRequests++;
    for (let i = 0; i < Math.min(a.calls.length, b.calls.length); i++) {
      if (ra[i] !== rb[i]) continue;
      for (const [id, x] of Object.entries(a.calls[i]!.response.answers)) {
        const y = b.calls[i]!.response.answers[id];
        if (!y) continue;
        const px: Record<string, number> = "noul" in x ? { yes: x.noul, no: 1 - x.noul } : "probabilities" in x ? x.probabilities : {};
        const py: Record<string, number> = "noul" in y ? { yes: y.noul, no: 1 - y.noul } : "probabilities" in y ? y.probabilities : {};
        const top = (p: Record<string, number>) => Object.entries(p).sort((u, v) => v[1] - u[1])[0]?.[0];
        const delta = Math.max(0, ...Object.keys(px).map((k) => Math.abs((px[k] ?? 0) - (py[k] ?? 0))));
        answersCompared++;
        if (top(px) !== top(py)) topFlips++;
        maxDelta = Math.max(maxDelta, delta);
        sumDelta += delta;
      }
    }
    if (!orderSame) orderDiffers++;
    if (gap > 1e-9) checkDiffers++;
    if (reqSame && orderSame && gap <= 1e-9) same++;
    else if (examples.length < 3) examples.push(`${row.id}: ${!reqSame ? "different requests; " : ""}${!orderSame ? `experiment ${a.exr} vs order taker ${b.exr}; ` : ""}${gap > 1e-9 ? `check differs by ${gap.toFixed(3)}` : ""}`);
  }
  const n = rows.length - missing;
  console.log(`\n${libName}  vs  ${labName}`);
  console.log(`  identical (requests, order, check):  ${same} of ${rows.length}`);
  console.log(`  same requests to Jev:                ${sameRequests} of ${n}`);
  console.log(`  different order built:               ${orderDiffers}`);
  console.log(`  check probabilities differ:          ${checkDiffers}${checkDiffers ? ` (largest gap ${maxCheckGap.toFixed(3)})` : ""}`);
  if (missing) console.log(`  not comparable (not in the cache):   ${missing}`);
  console.log(`  whole order right:                   experiment ${((100 * labRight) / Math.max(1, n)).toFixed(1)}%, order taker ${((100 * libRight) / Math.max(1, n)).toFixed(1)}%`);
  if (args.client !== "replay" && answersCompared)
    console.log(`  answers compared:                    ${answersCompared}: top answer changed ${topFlips} times; probability moved ${(sumDelta / answersCompared).toFixed(4)} on average, ${maxDelta.toFixed(3)} at most`);
  for (const e of examples) console.log(`    ${e}`);
}
