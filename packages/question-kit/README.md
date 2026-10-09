# question-kit: the core

The package's main entry. The kits are the other entries, with their own READMEs:
[question-kit/service-agent](service-agent/README.md) and [question-kit/order](order/README.md).

Ready-made methods for the jobs people most often give a System One model (Jev): classify a
message, pick which of many things it's about, pull out an exact value or a date, fill in a
function call, check an extracted record, search a document, screen messages, and more. Each method
writes the questions for you, sends them in as few requests as it can, does the code steps around
them, and returns a typed result with a confidence.

Underneath are the building blocks the methods use, there for your own questions: named state parts,
question helpers, readings with TypeSafe's confidence formulas, and checks that catch badly formed
questions before anything is sent.

```sh
npm install question-kit @typesafe-ai/sdk
```

> **Alpha.** question-kit is a prototype, and its APIs will change between 0.x releases. Please try
> it and tell us what breaks or feels awkward: [open an issue](https://github.com/Engid/question-kit/issues).
> We're not taking pull requests yet; if you'd like to contribute, open an issue first so we can
> talk it over.

## Connect Jev

Any object with a `systemOne(request)` method works. For TypeSafe's API, `question-kit/typesafe`
wraps their SDK (install `@typesafe-ai/sdk` alongside):

```ts
import { typesafeJev } from "question-kit/typesafe";
import { cachedJev } from "question-kit/cache";

const client = typesafeJev();                    // reads TYPESAFE_API_KEY
const cached = cachedJev(client, ".cache/jev");  // each distinct request is sent once; re-runs are free
```

`typesafeJev` retries rate limits (429), server errors such as 503 "model unavailable", timeouts and
dropped connections, with exponential backoff and jitter: 5 retries, waiting about 1, 2, 4, 8 and
16 seconds, and a server's `Retry-After` when it gives one. Each retry is reported on stderr. The
SDK does the retrying; `retry` changes its settings and `onRetry` where the reports go:

```ts
typesafeJev({ retry: { maxRetries: 2 }, onRetry: (m) => log.warn(m) }); // a live chat: give up sooner
typesafeJev({ retry: { maxRetries: 0 } });                                // no retries
```

It also paces requests, for batch runs: a short random wait between them (20 ms plus up to 50 ms)
and at most 50,000 input tokens a second, half of TypeSafe's current limit of 100,000 (and 80
requests a second), so a run doesn't lean on retries. `pace: false` turns it off; `pace: { … }`
changes it; `pacedJev(client, opts)` paces any client.

`cachedJev` keeps every answer on disk, keyed by a hash of the request. With `{ mode: "replay" }`
it never calls anything and throws `CacheMissError` on a request it hasn't seen, which suits tests
and repeatable measurements. For tests, `fakeJev((id, question, state) => answer)` answers without
calling anything.

## Methods

One-request methods return a *task*: run it with `run(client, task)`, or send several together with
`runAll` (below). Methods that need more than one request take `client` and return a promise.

| Method | Answers | Requests | Learned from (TypeSafe cookbook) |
| --- | --- | --- | --- |
| `classify` | which label fits; the parent label when unsure | 1 | Classification using confidence |
| `classifyTree` | which leaf of a label tree, keeping the best few paths | 1 per level | Hierarchical classification |
| `pickOne` | which one of many options, or none | 2 | Skill suggestion |
| `extractValue` | an exact value (email, phone, amount, number, name) | 1 | Pre-parsed value extraction |
| `extractDate` | a calendar date, including "tomorrow", "last Friday" | 1 | Date extraction |
| `callFunction` | which function and its arguments | 1 | Function calling |
| `verifyRecord` | whether anything in an extracted record is wrong | 1 | SDE cascade |
| `checkClaim` | whether a source supports, contradicts or ignores a claim | 0–1 | Double-checking citations |
| `search` | which line of a document answers a query, and whether any does | 1–2 | Line-by-line search |
| `rerank` | a shortlist in order of best match | 1 per candidate (or group) | Re-ranking |
| `matchRecords` | whether two records describe the same thing | 1 | Knowledge graph entity alignment |
| `screen` | which flags a message raises, and what to do | 1 | Guardrails for LLMs |
| `filterPassages` | which retrieved passages to give an answering model | 1 per passage | Classifying RAG passages |
| `recoverStructure` | Markdown rebuilt from text that lost its formatting | 2 | Structure recovery |
| `rubric` | many mixed questions about one text | 1 | Parallel questions |
| `featurize` | numeric features from text, for a predictive model | 1 per text | Autoresearch feature discovery |
| `stability`, `band` | how much answers move between repeats; an "uncertain" band | repeats | Self-consistency (nouls, choices) |

### classify

```ts
const intent = await run(client, classify("where is my package?", {
  track: { what: "Asking where an order is", examples: ["where's my order?"], parent: "orders" },
  cancel: { what: "Wants to cancel an order", parent: "orders" },
  password: { what: "Can't log in", parent: "account" },
}, { backoffBelow: 0.9 }));

intent.value;       // "track", or "none" when nothing fits
intent.confidence;  // 0–1
intent.level;       // "parent" (with intent.parent = "orders") when confidence was under 0.9
```

### pickOne

```ts
const orders = fromRecords(customer.orders, (o) => o.id, (o) => `${o.item}, ordered ${o.date}, ${o.status}`);
const which = await pickOne(client, "the blender still hasn't come", orders, {
  noun: "order",
  gates: ["The customer is talking about one of their own orders."],
});
which.value;  // "4410982", or null (which.reason: "gate" | "no-fit")
```

### extractValue

```ts
const id = await run(client, extractValue("I called on 10/02 about order 4410982", { kind: "number", role: "the order number" }));
id.value;  // "4410982": always text that's really in the message, never invented

await run(client, extractValue(text, { kind: "email", role: "the email the receipt should go to" }));   // lowercased
await run(client, extractValue(text, { kind: "phone", role: "the customer's mobile number" }));        // +14155550177
await run(client, extractValue(text, { kind: { names: ["Crystal Minh", "David Minh"] }, role: "the person writing" }));
await run(client, extractValue(text, { kind: /\bTRK-\d{8}\b/g, role: "the tracking number" }));
```

### extractDate

```ts
const due = await run(client, extractDate("it was due last Friday", { role: "the date the package was due", today: "2026-10-07" }));
due.date;    // "2026-10-02"
due.review;  // true when a person should check (low confidence, or parts that don't make a date)

// No year in the text: `expect` picks it (past, future, or by default the nearest).
const bought = await run(client, extractDate("I bought it on December 20", { role: "the date it was bought", today: "2026-10-07", expect: "past" }));
bought.date;        // "2025-12-20"
bought.yearGuessed; // true
```

### callFunction

```ts
const call = await run(client, callFunction("a large oat latte with an extra shot, to go", {
  order_drink: {
    does: "Order a coffee drink.",
    params: {
      drink: { kind: "one", about: "the drink", values: { latte: "A latte", americano: "An americano" } },
      size: { kind: "one", about: "the size of the drink", values: { small: "Small", large: "Large" }, default: "small" },
      extras: { kind: "many", about: "the extras", values: { extra_shot: "An extra shot", oat_milk: "Oat milk" } },
      to_go: { kind: "flag", about: "The customer wants it to go." },
    },
  },
  track_order: {
    does: "Find out where a delivery is.",
    params: { order_number: { kind: "value", about: "the order number", extract: { kind: "number" } } },
  },
}, { who: "the customer" }));

call.name;     // "order_drink"
call.args;     // { drink: "latte", size: "large", extras: ["extra_shot", "oat_milk"], to_go: true }
call.omitted;  // parameters left at their defaults because the request didn't state them
call.weakest;  // which answer the confidence came from
```

### verifyRecord

```ts
const v = await run(client, verifyRecord(emailText, {
  order_number: { description: "the order's number" },
  delivery_date: { description: "when it should arrive", date: "future" },
}, extracted, { today: "2026-10-07" }));
v.ok;       // false when any one check is confident something is wrong
v.flagged;  // [{ field: "order_number", check: "unsupported", probability: 0.93 }]
v.dates;    // { delivery_date: { found: "2026-10-09", matches: true, yearGuessed: true, confidence: 0.97 } }
v.review;   // fields a person should look at anyway, and why
```

Date fields (`date: true`, or where the date is expected to fall) aren't asked about with yes/no
questions, which read "October 9" against 2026-10-09 too literally when the text has no year. The
source's date is read with `extractDate` in the same request and compared in code: the month and day
when the text gives no year, the whole date otherwise.

### checkClaim, search, rerank, matchRecords

```ts
await run(client, checkClaim("Sale items can be refunded.", policyText));                   // verdict: "contradicted"
await run(client, checkClaim(claim, policyText, { quote: "within 60 days" }));               // "fabricated" if the quote isn't there
await search(client, policyText, "how long do refunds take?");                              // verdict + best lines
await rerank(client, "a waterproof hiking jacket", productDescriptions);                      // best first
await run(client, matchRecords(crmRow, orderRow, { noun: "customers", fields: { email: "email address" } }));  // "same" | "review" | "different"
```

### screen

```ts
const s = await run(client, screen(message, {
  wants_person: { statement: "The customer asks to talk to a human agent.", action: "handoff" },
  will_leave: { statement: "The customer threatens to cancel or close their account.", action: "retain" },
}, { precedence: ["handoff", "retain"], policy: POLICIES.strict }));
s.action;     // "handoff" | "retain" | "review" | "pass"
s.triggered;  // which flags, how likely, and what each called for
```

### filterPassages, recoverStructure, rubric, featurize, stability

```ts
await filterPassages(client, query, passages);           // include / conflict / exclude, with reasons
await recoverStructure(client, flattenedText);           // { markdown, blocks }
await run(client, rubric(ticket, {
  refund: { statement: "The customer asks for money back." },
  topic: { choose: "What is it mainly about?", options: { billing: "Charges", shipping: "Deliveries" } },
  urgency: { rate: "How urgent does it sound?", levels: ["No rush", "Soon", "Right away"] },
}));
await featurize(client, reviews, { positive: { statement: "The review is positive overall." } });  // [{ positive: 0.93 }, …]
await stability(client, { refund: check(text, "The customer asks for a refund.") }, 5);              // spread per question
```

## Several methods in one request

TypeSafe recommends asking everything about the same state in one request. `runAll` sends several
tasks together. Each task's state goes under its name, and its question ids are prefixed with it.
Text several tasks were given is sent once, under the first task's name, and the others point at
it. To give it a name of your own, put it in the state yourself and point at it with a `Ref`:

```ts
const message = ref("message");
const r = await runAll(client, {
  intent: classify(message, intents),
  order: extractValue(message, { kind: "number", role: "the order number", source: text }),
  due: extractDate(message, { role: "the date it was supposed to arrive", today }),
  person: check(message, "The customer asks to talk to a human agent."),
}, { state: { message: text } });

r.intent.value; r.order.value; r.due.date; r.person.probability;
```

## Building blocks

- **State and references.** `ref("orders").at("o2")` is the path `orders.o2`. Inside ``q`…` ``
  text it's written in backticks, the way TypeSafe recommends pointing questions at the state.
  `keyed(list, "o")` turns a list into `{ o1, o2, … }` so each item can be pointed at.
- **Questions.** `choice(instructions, options, { none })`, `noul(instructions, { true, false })`
  and `score(instructions, levels)`. Options can be text or `{ what, not_for, examples }`.
- **One-question tasks.** `check(text, statement)`, `checks(text, { id: statement })`,
  `choose(text, options)` and `rate(text, question, levels)`.
- **Readings.** `readChoice`, `readNoul` and `readScore` give a value, a probability and a
  confidence:
  - Choice: `(p_max − 1/n) / (1 − 1/n)`;
  - Score: the spread around the most likely level, against an even spread;
  - Noul: `|2p − 1|`.

  `lowest(...)` combines confidences, `band(p, { no, yes })` gives yes / no / uncertain,
  `decide(reading, cuts)` gives act / confirm / person (with per-option cut-offs for options with
  different stakes), and `weighted(scores, weights)` combines Scores.
- **Checks before sending.** `run` and `runAll` refuse a request with errors and collect warnings:
  - errors: a question with no instructions, a backticked path that isn't in the state, a Choice
    with fewer than 2 or more than 255 options;
  - warnings: Nouls phrased in the negative or asking two things, and questions that look like
    arithmetic or counting.
- **Request size.** A request that would be too big is split into several. Jev answers each
  question independently, so the answers don't change. `estimateTokens` and `estimateCost` say what
  a request or a log costs.

## Recording gate decisions

When code acts on an answer only above a confidence, it can report what it decided: the method, the
task, the confidence, the threshold, and the decision ("act", "unsure", "skip"). That's all that's
recorded by default; it shows where and how often answers fall under a gate.

```ts
import { consoleRecorder, gate, memoryRecorder, noRecorder } from "question-kit";
import { jsonlRecorder } from "question-kit/node";

gate(r.confidence, 0.9, consoleRecorder, { method: "classify", task: "intent" }); // "act" or "unsure", and a line on stderr
```

A `Recorder` is any object with `record(event)`. `noRecorder` is the default; `jsonlRecorder(path)` (from `question-kit/node`)
appends JSON lines; `memoryRecorder()` keeps events in memory. `question-kit/service-agent` reports
every gate through one.

## Acknowledgements

These methods were inspired by the great work of the authors of TypeSafe's
[cookbooks](https://docs.typesafe.ai/cookbooks.md), and by their documentation on
[question design](https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md) and
[confidence](https://docs.typesafe.ai/confidence.md). The code and question wording here are our
own. Where a method takes a cookbook's approach, its source file says which one.
