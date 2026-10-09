// bun run service:chat — chat in the terminal with the store's service agent (store.ts), on live Jev.
//
//   bun run service:chat             type as the customer; an empty line ends the chat
//   bun run service:chat --gates     also print each reading Jev made and what its gate did
//   bun run service:chat --replay    cached answers only (never calls the API)
//
// Needs TYPESAFE_API_KEY in .env, unless every answer is cached. Try order 1234567890 with
// ana@example.com (delivered 12 days ago), 5550001111 (not shipped yet), or 9876543210 with
// sam@example.com (delivered 45 days ago).

import { join } from "node:path";
import { parseArgs } from "node:util";
import { type AgentEvent, turn, type TurnResult } from "question-kit/service-agent";
import { consoleRecorder, estimateTokens, type SystemOneCall, noRecorder, PRICE_PER_MILLION_INPUT } from "question-kit";
import { CacheMissError, cachedJev } from "question-kit/cache";
import { typesafeJev } from "question-kit/typesafe";
import { runTool, service } from "./store.ts";

const { values: args } = parseArgs({ options: { gates: { type: "boolean", default: false }, replay: { type: "boolean", default: false } } });
const cacheDir = join(import.meta.dir, "..", "..", ".cache", "jev");
const client = args.replay ? cachedJev(undefined, cacheDir, { mode: "replay" }) : cachedJev(typesafeJev(), cacheDir);
const calls: SystemOneCall[] = [];
const opts = { client, calls, recorder: args.gates ? consoleRecorder : noRecorder, today: new Date().toISOString().slice(0, 10) };

let log: AgentEvent[] = [];
console.log("A made-up outdoor store's support chat. Type as the customer; an empty line ends it.\n");
process.stdout.write("You: ");
for await (const line of console) {
  const text = line.trim();
  if (!text) break;
  let r: TurnResult;
  try {
    r = await turn(service, log, { type: "customer", text }, opts);
    for (;;) {
      for (const m of r.messages) console.log(`Agent: ${m}`);
      if (r.action.type !== "call") break;
      // The app runs the tool and tells the agent what happened.
      const result = runTool(r.action.tool, r.action.values);
      if (result.note) console.log(`        [${result.note}]`);
      r = await turn(service, r.log, { type: "result", tool: r.action.tool, step: r.action.step, ...result }, opts);
    }
  } catch (err) {
    if (!(err instanceof CacheMissError)) throw err;
    console.log("\n(That answer isn't cached: run without --replay to ask Jev.)");
    break;
  }
  log = r.log;
  if (r.view.ended) {
    console.log(`\n(${r.view.ended.how === "done" ? "finished" : `handed off: ${r.view.ended.reason}`})`);
    break;
  }
  process.stdout.write("You: ");
}
const tokens = calls.reduce((s, x) => s + (x.response.usage?.input_tokens || estimateTokens(x.request.state, x.request.questions)), 0);
console.log(`${calls.length} requests to Jev, ${tokens.toLocaleString()} input tokens, about $${((tokens / 1e6) * PRICE_PER_MILLION_INPUT).toFixed(4)} (cached answers included).`);
