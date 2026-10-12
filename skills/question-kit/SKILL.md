---
name: question-kit
description: Build with question-kit, the TypeScript kit for Jev (TypeSafe's System One model). Use when writing code that classifies, extracts, verifies, searches or screens text with Jev, when configuring the question-kit service agent or order taker, or when writing questions for Jev directly. Covers the mental model, which method to use, composing methods in one request, thresholds, testing with the cache, and the traps.
---

# question-kit

question-kit is a TypeScript library (ESM, Node 20+ or Bun) for building on Jev, TypeSafe's System
One model. This file is the guide; `reference.md` next to it lists every export with its options
and defaults. The package README (`README.md` in the same package) has worked examples per method.
Version 0.2.x is an alpha: APIs change between 0.x releases, so check `reference.md` against the
installed version rather than remembering an older one.

## The mental model (read this first)

Jev does not generate text. A request is **state** (any JSON: a message, a record, a document)
plus a batch of **closed questions** about that state, and the answer is a **probability for every
option** of every question. Three question types:

- **Choice**: which one of these options? (`probabilities` per option, 2–255 options)
- **Noul**: is this statement true? (one probability)
- **Score**: where on these ordered levels? (a probability per level)

Consequences that shape every design:

1. **Jev can't write a value out.** To extract something, *code* finds the candidates (a regex, a
   list of names, the lines of a document) and Jev *chooses* among them. Nothing is hallucinated
   because nothing is generated.
2. **Code decides, Jev informs.** Every reading comes back with a probability and a
   confidence; code applies a threshold (a "gate") and acts, asks again, backs off, or hands to a
   person. Thresholds are set from measurements on your own cases, not by feel.
3. **Question ids are not sent to the model.** Jev sees only the state and the question bodies.
   The instructions must hold the whole question; the id is for your code.
4. **Ask everything about one state in one request.** Jev answers each question independently, and
   one request is faster and cheaper than several. question-kit's `runAll` does this.
5. **Questions point at state by path.** Instructions refer to parts of the state in backticks
   (`` `message` ``, `` `orders.o2` ``); question-kit's `ref`/`q` write those paths for you and
   `lint` rejects a path that isn't in the state.

## Install and connect

```sh
npm install question-kit @typesafe-ai/sdk     # the SDK is an optional peer, used by question-kit/typesafe
```

```ts
import { typesafeJev } from "question-kit/typesafe";
import { cachedJev } from "question-kit/cache";

const live = typesafeJev();                                   // reads TYPESAFE_API_KEY; retries + pacing built in
const client = cachedJev(live, ".cache/jev");                 // every distinct request asked once; re-runs free
const replay = cachedJev(undefined, ".cache/jev", { mode: "replay" });  // never calls the API; a miss throws CacheMissError
```

Any object with `systemOne(request)` is a client (`SystemOneClient`). The key belongs on a server;
the core, order kit and agent all bundle for the browser.

Entry points: `question-kit` (core: methods and building blocks), `question-kit/service-agent`,
`question-kit/order`, `question-kit/cache`, `question-kit/typesafe`, `question-kit/node`
(a file-writing recorder).

## Pick the method

One-request methods return a **task**; send it with `run(client, task)` or several together with
`runAll(client, { name: task, … })`. Methods that need more than one request take `client` and
return a promise.

| You want | Use | Notes |
| --- | --- | --- |
| which of a few labels fits a text (≤ ~240) | `classify(text, labels, { backoffBelow })` | one Choice + "none"; give labels `examples`, `not_for`, and a `parent` to back off to |
| which of many things a text is about (orders, skills, records) | `pickOne(client, text, catalog, { noun, fitsBelow })` | 2 requests: rank, then check the fit of a shortlist; `fitsBelow` depends on the catalog |
| a leaf of a label tree | `classifyTree(client, text, tree)` | only when the leaves don't fit one Choice; a flat `classify` with parents did better in our evals |
| an exact value in the text (email, phone, amount, number, id, name) | `extractValue(text, { kind, role })` | code finds candidates, Jev picks; value is always text from the input |
| a calendar date ("last Friday", "10/02", "in three days", "the end of the month") | `extractDate(text, { role, today, expect })` | Jev reads the parts, code does the calendar; `review` flags doubtful ones |
| which function to call and its arguments | `callFunction(text, functions, { who })` | one request; params of kind one / many / flag / value / date |
| whether an extracted record has anything wrong | `verifyRecord(source, schema, record, { flagAbove, today })` | yes/no checks per field; date fields compared in code |
| whether a source supports a claim | `checkClaim(claim, source, { quote })` | verified / contradicted / unsupported / fabricated |
| which line of a document answers a query, if any | `search(client, lines, query, { foundAt, absentBelow })` | Choice over lines + Noul "answered at all?" |
| a shortlist in best-match order | `rerank(client, query, candidates, { match })` | one Noul per candidate |
| whether two records are the same thing | `matchRecords(a, b, { noun, fields })` | same / review / different |
| which flags a message raises and what to do | `screen(text, flags, { precedence, policy })` | one Noul per flag; policy thresholds + precedence in code |
| which retrieved passages to give an answering model | `filterPassages(client, query, passages)` | include / conflict / exclude with reasons |
| Markdown rebuilt from flattened text | `recoverStructure(client, text)` | 2 requests |
| many mixed questions about one text | `rubric(text, items)` | Nouls, Choices and Scores in one request |
| numeric features per text | `featurize(client, texts, items)` | probabilities as features |
| how much an answer moves between repeats | `stability(client, tasks, repeats)` | spread per question |
| a yes/no, a pick, or a rating of your own | `check`, `checks`, `choose`, `rate` | the one-question tasks the methods are made of |

For a conversation (customer service), configure the agent instead of composing methods:
`question-kit/service-agent` (below). For a one-message order against a menu,
`question-kit/order`.

## Compose: everything about one text in one request

```ts
import { check, classify, extractDate, extractValue, ref, runAll, type SystemOneCall } from "question-kit";

const log: SystemOneCall[] = [];
const message = ref("message");               // a path into state you provide
const r = await runAll(client, {
  intent: classify(message, INTENTS, { backoffBelow: 0.9 }),
  order: extractValue(message, { kind: /\b\d{7}\b/g, role: "the order number", source: text }),  // `source`: the text, so code can find candidates
  due: extractDate(message, { role: "the date it was due", today: "2026-10-07", expect: "past" }),
  person: check(message, "The customer asks to talk to a person."),
}, { state: { message: text }, log, title: "triage", about: { intent: "queue", order: "order no." } });

r.intent.value; r.intent.confidence; r.intent.level;   // "parent" when it backed off
r.order.value;                                         // "4410982" or null
r.due.date; r.due.review;
r.person.probability;
```

Each task's questions are prefixed `task::question`; text several tasks were given is sent once.
`about` is kept in the request's `meta`, never sent. `log` collects every request with its
answers and timing; `estimateCost(log)` prices it (input tokens at `PRICE_PER_MILLION_INPUT`).

## Act on the readings

Readings carry `probability` and `confidence` (TypeSafe's formulas: Choice `(p_max − 1/n)/(1 − 1/n)`,
Noul `|2p − 1|`, Score the spread around the likeliest level). Patterns that work:

- **Gate, then act / ask / back off / hand off.** `classify` backs off to a `parent` under
  `backoffBelow`; `extractDate` sets `review`; `verifyRecord` flags above `flagAbove`; `screen`
  applies a `policy` (`act`, `review`) and a `precedence`. Report decisions through a `Recorder`
  (`gate(confidence, threshold, recorder, { method, task })`) so you can see where readings land.
- **Set thresholds from data.** Run a few dozen labeled cases through the cache, look at the
  confidences of the wrong answers, put the gate where it separates them. The defaults in the
  kit were set this way on our own sets and are starting points, not truths; `pickOne`'s
  `fitsBelow` in particular depends on the catalog (an intent list reads high; a few records read
  low).
- **Keep the reason with the decision** (which gate, which confidence) for the person who reads the
  queue or the log.

## Write the labels well; it matters more than anything else

In our evals of `classify`: written descriptions mostly made Jev *surer* without making it much
more *accurate*; two real examples per label raised accuracy and cut confident wrong answers by
nearly half. So:

- name labels plainly; give each `{ what, examples: [two real ones], not_for }`;
- write `not_for` for the pairs that get confused, not for everything;
- give labels a `parent` and set `backoffBelow`, so an unsure answer lands on something true;
- for Nouls, state the thing you're looking for so that *yes* means it ("The customer asks to talk
  to a person."), one claim per question; `lint` warns on negatives and double questions;
- never ask Jev to count, sum or compute dates; do that in code and ask one question per item.

## Your own questions

```ts
import { choice, noul, score, q, ref, keyed, readChoice, readNoul, send, lint } from "question-kit";

const state = { message: text, orders: keyed(orders, "o") };          // orders.o1, orders.o2, …
const questions = {
  which: choice(q`Which of ${ref("orders")} is ${ref("message")} about?`, { o1: "…", o2: "…" }, { none: "None of them." }),
  upset: noul(q`About ${ref("message")}: the customer is upset.`),
};
lint(state, questions);                       // errors: bad path, no instructions, Choice outside 2–255; warnings: negatives, two questions, arithmetic
const answers = await send(client, state, questions);   // splits a too-big request; question ids stay yours
readChoice(answers.which).value; readNoul(answers.upset).probability;
```

Or make a `Task` (`{ parts, questions(at), read(answers) }`) and it composes with `runAll` like
the built-in methods; `check`/`choose`/`rate` take the whole question as a function of the text's
`Ref` when the default wording isn't right.

## The service agent (`question-kit/service-agent`)

A customer-service conversation run from a **description**: intents (what customers come for),
slots (what to collect and how each value is found), tools (what your system does), procedures
(each intent's steps). Code runs the procedure; Jev reads the customer; every reading passes a
gate; nothing is written by a model (templates only). Minimal shape:

```ts
import { defineService, turn, type AgentEvent } from "question-kit/service-agent";

const service = defineService({
  intents: { refund: { name: "Refund", description: "…", examples: ["I want a refund"] } },
  slots: {
    order_id: { label: "order ID", format: "10 digits", pattern: /\b\d{10}\b/g },   // code finds candidates, Jev picks
    method: { label: "refund method", options: { card: "back to the card", credit: "store credit" } },
  },
  tools: {
    "look-up-order": { description: "find the order", needs: ["order_id"] },
    refund: { description: "refund the order", needs: ["method"], changes: true },   // changes: read back and confirmed first
  },
  procedures: { refund: ["look-up-order", { optional: ["refund"] }] },              // optional: Jev picks from the written procedure
});

let log: AgentEvent[] = [];                                   // the log is the whole state; plain JSON
let r = await turn(service, log, { type: "customer", text }, { client });
while (r.action.type === "call") {                            // the agent never runs a tool itself
  const result = await runTool(r.action.tool, r.action.values);   // → { ok, values?, note?, records?, say? }
  r = await turn(service, r.log, { type: "result", tool: r.action.tool, step: r.action.step, ...result }, { client });
}
log = r.log; show(r.messages);                                // r.action: ask | check-value | confirm | clarify | wrap-up | done | handoff | …
```

Rules of thumb: slot kinds are exactly one of `pattern` | `list` | `options` | `date` | `menu` |
`from`; a tool result's `note` is what Jev reads about what the system found, so put the facts a
procedure's conditions turn on in it; `changes: true` for anything that alters an order, account
or money; put conditional policy in the intent's `procedure` text and the steps it chooses among
in `{ optional: [...] }`; `{ try: [...] }` for troubleshooting; `aside: true` for questions
askable at any point; `{ repeat: [...] }` with a `menu` slot for orders built up over messages.
Gates default to `intent` 0.9, `value` 0.9, `policy` 0.9, `confirm` 0.8, `repeat` 0.7,
`yesNo` 0.6; tune from a `recorder`, not by feel.

## The order taker (`question-kit/order`)

`takeOrder(text, defineMenu({...}), client)` reads one message against a menu you describe (kinds
of item, fields, the ways customers say each value): code tags the words the menu knows, Jev tags
the rest in one request, code groups words into items, and Jev checks the read-back (one Noul per
item plus "anything missing?"). Result: `items`, `readBack`, `accept`, `confirm`, `check`. Only an
English pizza menu has been through evals; a menu written from scratch needs good lists of ways
to say things, or `design: "every-word"`.

## Testing and cost

- **Record once, replay forever.** `cachedJev` keys on what the model sees (state + question
  bodies, not ids). Replay mode is for CI and for changing the code around the questions without
  paying again. Changing a question's *wording* is a new request by design.
- **Unit tests**: `fakeJev((id, question, state) => answer)` answers from a function; a Choice
  answer can be just the option id, a Noul a probability, a Score `{ level }`.
- **Cost**: input tokens only, `PRICE_PER_MILLION_INPUT` (0.042 $/M at the time of writing);
  `estimateTokens(state, questions)` before sending, `estimateCost(log)` after. A typical
  one-message request is a few thousand tokens, a fraction of a cent.
- **Rate limits**: `typesafeJev` retries 429/503/timeouts with backoff and paces batch runs under
  TypeSafe's limits; in a live chat use fewer retries (`retry: { maxRetries: 2 }`).

## Traps

- Expecting text back. Jev returns probabilities; anything said to a user comes from your code or
  templates.
- Putting the question in the id, or leaving a Noul's instructions empty. Ids aren't sent.
- A Choice with one option, or more than 255. Shortlist or split (`pickOne` chunks for you).
- Asking Jev for dates, counts or sums. Read the parts, compute in code (`extractDate` does this).
- Giving `extractValue` a `Ref` without `source`: it can't find candidates in a path.
- Reusing cookbook thresholds unmeasured. They were set on other data; measure on yours.
- Negative Nouls ("the message is not about billing"): phrase for yes = found.
- Treating a reading under the gate as a hard "no". It's "unsure": ask, back off, or hand off.
- Editing the cache by hand, or expecting a replay after rewording a question.
