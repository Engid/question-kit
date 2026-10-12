// bun run triage — sort a support inbox with the core methods, one request per message.
//
//   bun run triage              on live Jev (TYPESAFE_API_KEY in .env), answers cached in .cache/jev
//   bun run triage --replay     cached answers only (never calls the API)
//   bun run triage --verbose    also print every reading, with its confidence
//
// The walkthrough is docs/tutorials/triage.md. For each message, one request asks everything about
// it at once (what it's about, the order number, the date, whether a person should take it); a
// question for the FAQ then gets a second, line-by-line search of the FAQ. Code acts only on
// readings over a confidence; the rest goes to a person with what Jev did read.

import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  classify,
  estimateCost,
  extractDate,
  extractValue,
  type Label,
  ref,
  runAll,
  screen,
  search,
  type SystemOneCall,
} from "question-kit";
import { CacheMissError, cachedJev } from "question-kit/cache";
import { typesafeJev } from "question-kit/typesafe";

const { values: args } = parseArgs({ options: { replay: { type: "boolean", default: false }, verbose: { type: "boolean", default: false } } });
const cacheDir = join(import.meta.dir, "..", "..", ".cache", "jev");
const client = args.replay ? cachedJev(undefined, cacheDir, { mode: "replay" }) : cachedJev(typesafeJev(), cacheDir);

// A fixed "today", so the dates come out the same on every run (and replay from the cache).
const TODAY = "2026-10-07";

// What customers write in. Each label gets a description, two real-sounding examples, and a parent
// to fall back to when Jev can't tell the children apart.
const INTENTS = {
  where_is_it: { what: "Asking where an order is or when it will arrive.", examples: ["where's my order?", "it was supposed to be here Friday"], parent: "orders" },
  cancel: { what: "Wants to cancel an order before it ships.", not_for: "returning something already delivered", examples: ["please cancel order 4410982", "I ordered by mistake, can you stop it?"], parent: "orders" },
  return: { what: "Wants to send something back or get money back for it.", not_for: "cancelling an order that hasn't shipped", examples: ["the jacket is too small, how do I return it?", "I'd like a refund for the tent"], parent: "orders" },
  charged: { what: "A charge on their card they don't recognise or think is wrong.", examples: ["I was charged twice", "why is there a $12 fee?"], parent: "billing" },
  login: { what: "Can't sign in, or wants to change account details.", examples: ["I forgot my password", "how do I change my email?"], parent: "account" },
  question: { what: "A question about the store itself: policies, shipping, opening hours.", not_for: "a question about one of their own orders", examples: ["do you ship to Canada?", "what are your hours?"] },
} satisfies Record<string, Label>;

// The store's FAQ, one line per fact. `search` ranks the lines against a question.
const FAQ = [
  "Our store in Boulder is open 9am to 6pm, Monday to Saturday, and closed on Sundays.",
  "Standard shipping takes 5 to 7 business days within the US; express takes 2.",
  "We ship to the US and Canada. Orders to Canada may be charged duties on delivery.",
  "Returns are accepted within 30 days of delivery, in the original packaging.",
  "Refunds go back to the original payment method within 5 business days of the return arriving.",
  "Gift cards can be used online and in the store, and don't expire.",
  "Sale items can be exchanged but not refunded.",
];

const INBOX = [
  "Hi, my order 4410982 was supposed to arrive last Friday and it still isn't here. Can you check?",
  "I ordered the wrong size on 10/02, order 4398811. Please cancel it before it ships!",
  "The boots I got on September 20 are already falling apart. I want my money back.",
  "There's a second charge of $89.99 on my card from you that I don't recognise.",
  "do you ship to canada?",
  "This is the third time I'm writing about order 4412007. I want to talk to an actual person, not a bot, or I'm done with this store.",
];

interface Triage {
  message: string;
  /** Where the message goes: a queue, or a person. */
  queue: string;
  intent: string;
  order: string | null;
  date: string | null;
  /** Why it went where it went. */
  because: string;
}

async function triage(text: string, log: SystemOneCall[]): Promise<Triage> {
  const message = ref("message");
  const r = await runAll(
    client,
    {
      intent: classify(message, INTENTS, { backoffBelow: 0.9 }),
      order: extractValue(message, { kind: /\b\d{7}\b/g, role: "the customer's order number", source: text }),
      date: extractDate(message, { role: "the date the customer gives for their order", today: TODAY, expect: "past" }),
      flags: screen(
        message,
        {
          wants_person: { statement: "The customer asks to talk to a person rather than an automated system.", action: "person" },
          will_leave: { statement: "The customer says they will stop shopping with the store, or threatens to.", action: "retain" },
        },
        { precedence: ["person", "retain"] },
      ),
    },
    { state: { message: text }, log, title: "triage", about: { intent: "which queue", order: "order number", date: "the order's date", flags: "escalation" } },
  );

  if (args.verbose) {
    console.log(`  intent  ${r.intent.value} (${r.intent.confidence.toFixed(2)}${r.intent.level === "parent" ? `, backed off to ${r.intent.parent}` : ""})`);
    console.log(`  order   ${r.order.value ?? "none"} (${r.order.confidence.toFixed(2)}; candidates ${r.order.candidates.join(", ") || "none"})`);
    console.log(`  date    ${r.date.date ?? "none"} (${r.date.confidence.toFixed(2)}${r.date.review ? `, review: ${r.date.note}` : ""})`);
    console.log(`  flags   ${r.flags.action} (${r.flags.triggered.map((t) => `${t.flag} ${t.probability.toFixed(2)}`).join(", ") || "none"})`);
  }

  const order = r.order.value;
  const date = r.date.review ? null : r.date.date;
  const base = { message: text, intent: r.intent.value, order, date };

  // Escalation first: a flag that fired outranks the queue the intent would pick.
  if (r.flags.action === "person") return { ...base, queue: "a person", because: "asks for a person" };
  if (r.flags.action === "retain") return { ...base, queue: "retention", because: "says they'll leave" };
  if (r.flags.action === "review") return { ...base, queue: "a person", because: `might need one: ${r.flags.triggered.map((t) => t.flag).join(", ")}` };

  // A question about the store: look for the answer in the FAQ (a second request, over the lines).
  if (r.intent.value === "question") {
    const found = await search(client, FAQ, text, { log });
    if (found.verdict === "answered") return { ...base, queue: "auto-reply", because: `FAQ: "${found.lines[0]!.text}"` };
    return { ...base, queue: "a person", because: `not in the FAQ (${found.answered.toFixed(2)} that any line answers it)` };
  }

  // The intent decides the queue when Jev was sure of it; the parent is the queue when it wasn't.
  if (r.intent.value === "none") return { ...base, queue: "a person", because: "fits none of the intents" };
  if (r.intent.level === "parent") return { ...base, queue: `${r.intent.parent} (unsorted)`, because: `intent unsure (${r.intent.confidence.toFixed(2)})` };
  const needsOrder = r.intent.value === "where_is_it" || r.intent.value === "cancel";
  if (needsOrder && !order) return { ...base, queue: "ask for the order number", because: "no order number in the message" };
  return { ...base, queue: r.intent.value, because: `intent ${r.intent.confidence.toFixed(2)}` };
}

const log: SystemOneCall[] = [];
try {
  for (const text of INBOX) {
    console.log(`\n> ${text}`);
    const t = await triage(text, log);
    console.log(`  → ${t.queue}  (${t.because})${t.order ? `  order ${t.order}` : ""}${t.date ? `  date ${t.date}` : ""}`);
  }
} catch (err) {
  if (!(err instanceof CacheMissError)) throw err;
  console.log("\n(That answer isn't cached: run without --replay to ask Jev.)");
  process.exit(1);
}
console.log(`\n${log.length} requests, about $${estimateCost(log).toFixed(4)}; cache: ${client.stats.hits} hits, ${client.stats.misses} misses.`);
