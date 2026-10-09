// bun run pizza:check — run the scripted conversations (conversations.ts) through the shop and score
// the order each ends with. The script plays the customer, answering the agent from the gold order.
//
//   bun run pizza:check                      record: cached answers, Jev for the rest (needs TYPESAFE_API_KEY)
//   bun run pizza:check --client replay      cached answers only
//   bun run pizza:check --client fake        the rule-of-thumb stand-in, no Jev: a smoke test of the plumbing, and a cost estimate
//   bun run pizza:check --only "change"      conversations whose name contains it
//   bun run pizza:check --show               print each chat as it goes

import { join } from "node:path";
import { parseArgs } from "node:util";
import { type Action, type AgentEvent, defaultTemplates, turn, type TurnResult, view } from "question-kit/service-agent";
import { estimateCost, type SystemOneCall } from "question-kit";
import { CacheMissError, cachedJev } from "question-kit/cache";
import { typesafeJev } from "question-kit/typesafe";
import { type Conversation, conversations } from "./conversations.ts";
import { fakeShopClient } from "./fake.ts";
import { Register } from "./register.ts";
import { shop, wording } from "./shop.ts";

const { values: args } = parseArgs({ options: { client: { type: "string", default: "record" }, only: { type: "string" }, show: { type: "boolean", default: false } } });
const cacheDir = join(import.meta.dir, "..", "..", ".cache", "jev");
const client = args.client === "fake" ? fakeShopClient() : args.client === "replay" ? cachedJev(undefined, cacheDir, { mode: "replay" }) : cachedJev(typesafeJev(), cacheDir);
const calls: SystemOneCall[] = [];
const templates = { ...defaultTemplates, ...wording };
const PHONE = "4795550100";
const MOST_CORRECTIONS = 2;

const sorted = (xs: string[]) => [...xs].sort();
const same = (a: string[], b: string[]) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** The customer: says their moves, then answers the agent's questions by comparing the register with the gold order. */
class Customer {
  moves: string[];
  corrections = 0;
  constructor(readonly c: Conversation) {
    this.moves = [...c.moves];
  }
  /** What the customer says next, or null when they give up. */
  reply(action: Action, lines: string[]): string | null {
    const right = same(lines, this.c.lines);
    switch (action.type) {
      case "ask-intent":
      case "clarify":
      case "repeat-ask":
        if (this.moves.length) return this.moves.shift()!;
        if (action.type !== "repeat-ask") return null;
        return right ? "that's all" : this.correction(lines);
      case "repeat-check":
        return right ? "yes" : this.correction(lines);
      case "ask":
        return PHONE;
      case "check-value":
        return "yes";
      case "confirm":
        if (this.c.declines) return "no, hold on";
        return right ? "yes" : "no, hold on";
      case "ask-fixed":
        return "yes";
      case "wrap-up":
        return "no thanks";
      default:
        return null;
    }
  }
  /** What's wrong, as a customer would put it: what to take off, what it should be, what's missing. */
  correction(lines: string[]): string | null {
    if (++this.corrections > MOST_CORRECTIONS) return null;
    const extra = [...lines];
    const missing = [...this.c.lines];
    for (const l of [...extra]) {
      const k = missing.indexOf(l);
      if (k >= 0) {
        missing.splice(k, 1);
        extra.splice(extra.indexOf(l), 1);
      }
    }
    const noNumber = (l: string) => l.replace(/^\d+ /, "");
    const once = (xs: string[]) => [...new Set(xs)];
    if (extra.length && missing.length) return `no, ${list(once(extra).map((l) => `the ${noNumber(l)}`))} should be ${list(once(missing))}`;
    if (extra.length) return `no, take off ${list(once(extra).map((l) => `the ${noNumber(l)}`))}`;
    return `no, I also wanted ${list(once(missing))}`;
  }
}

async function run(c: Conversation): Promise<{ lines: string[]; placed: boolean; ended: string | null; gaveUp: boolean; chat: string[] }> {
  const reg = new Register();
  const customer = new Customer(c);
  let log: AgentEvent[] = [];
  const chat: string[] = [];
  let text: string | null = customer.moves.shift()!;
  let gaveUp = false;
  while (text !== null) {
    chat.push(`You: ${text}`);
    reg.newMessage();
    let r: TurnResult = await turn(shop, log, { type: "customer", text }, { client, calls, templates });
    const said = [...r.messages];
    while (r.action.type === "call") {
      const { did, ...result } = reg.run(r.action.tool, r.action.values);
      chat.push(`  [${r.action.tool}: ${did}]`);
      r = await turn(shop, r.log, { type: "result", tool: r.action.tool, step: r.action.step, ...result }, { client, calls, templates });
      said.push(...r.messages);
    }
    for (const e of r.log.slice(log.length)) if (e.type === "read-review" && e.doubt) chat.push(`  (Jev doubts the order: ${[...e.wrong.filter((w) => w.p >= shop.readBackAt).map((w) => `"${w.text}" ${w.p.toFixed(2)}`), ...(e.missing >= shop.readBackAt ? [`missing ${e.missing.toFixed(2)}`] : [])].join(", ")})`);
    chat.push(`Agent: ${said.join(" ")}`);
    log = r.log;
    if (r.view.ended) break;
    text = customer.reply(r.action, reg.lines.map((l) => reg.readBack([l.item])[0]!));
    if (text === null) {
      gaveUp = true;
      chat.push(`You: (gives up: ${customer.corrections > MOST_CORRECTIONS ? "the order was still wrong after two corrections" : `nothing to say to "${r.action.type}"`})`);
    }
  }
  const v = view(log);
  return { lines: reg.lines.map((l) => reg.readBack([l.item])[0]!), placed: reg.orderNumber !== null, ended: v.ended ? `${v.ended.how}${v.ended.reason ? `: ${v.ended.reason}` : ""}` : null, gaveUp, chat };
}

const picked = conversations.filter((c) => !args.only || c.name.includes(args.only));
let pass = 0;
let count = 0;
const hard: string[] = [];
for (const c of picked) {
  let got: Awaited<ReturnType<typeof run>>;
  try {
    got = await run(c);
  } catch (err) {
    if (err instanceof CacheMissError) {
      console.log(`  ?  ${c.name}: an answer isn't cached (run without --client replay)`);
      continue;
    }
    throw err;
  }
  const wantPlaced = c.placed ?? true;
  const ok = same(got.lines, c.lines) && got.placed === wantPlaced && !got.gaveUp;
  if (!c.hard) {
    count++;
    if (ok) pass++;
  } else if (ok) hard.push(c.name);
  const flag = ok ? "ok " : c.hard ? "hard" : "FAIL";
  console.log(`  ${flag} ${c.name}${ok ? "" : `: got [${got.lines.join(" | ")}]${got.placed !== wantPlaced ? `, ${got.placed ? "placed" : "not placed"}` : ""}${got.ended ? ` (${got.ended})` : ""}`}`);
  if (args.show || !ok) for (const l of got.chat) console.log(`       ${l}`);
}
console.log(`\n${pass} of ${count} right${hard.length ? `; known-hard cases that passed anyway: ${hard.join(", ")}` : ""}.`);
console.log(`${calls.length} requests, about $${estimateCost(calls).toFixed(4)}${args.client === "fake" ? " if Jev had answered them" : ""}.`);
