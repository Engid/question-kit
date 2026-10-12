# Tutorial: sort a support inbox with the core

A walk through building something small from the building blocks: a triage step that reads each
message in a support inbox and decides where it goes. The finished program is
[`examples/triage/triage.ts`](../../examples/triage/triage.ts) (`bun run triage`); this page
builds it up in the order the questions came up, with what each piece is for and why it's
written the way it is. [Getting started](../getting-started.md) covers installing and connecting
Jev; [the building blocks](../building-blocks.md) is the map of every method.

The inbox is six made-up messages to an outdoor-gear store. For each one we want:

- which queue it belongs in (where's my order, cancel, return, billing, account, or a question
  about the store);
- the order number and the date, if the message gives them, so the queue has them ready;
- whether a person should take it instead: the customer asks for one, or says they're leaving;
- for a question about the store, whether the FAQ answers it, so a reply can go out on its own.

Jev doesn't write anything, so none of this is "ask the model what to do". Every step is a closed
question with a probability for each answer, and code decides what to do with the probabilities.
That's the pattern the whole tutorial repeats.

## 1. Which queue: `classify`

The first question is which of a few labels fits the message. `classify` builds one Choice
question over the labels, adds a "none of these" option (a message may fit nothing), and reads the
answer back with a confidence.

```ts
import { classify, run } from "question-kit";

const INTENTS = {
  where_is_it: { 
    what: "Asking where an order is or when it will arrive.", 
    examples: ["where's my order?", "it was supposed to be here Friday"], 
    parent: "orders" 
  },
  cancel: { 
    what: "Wants to cancel an order before it ships.", 
    examples: ["please cancel order 4410982"], 
    not_for: "returning something already delivered", 
    parent: "orders" 
  },
  return: { 
    what: "Wants to send something back or get money back for it.", 
    not_for: "cancelling an order that hasn't shipped", 
    examples: ["the jacket is too small, how do I return it?"], 
    parent: "orders" 
  },
  charged: { 
    what: "A charge on their card they don't recognise or think is wrong.", 
    examples: ["I was charged twice"], 
    parent: "billing" 
  },
  login: { 
    what: "Can't sign in, or wants to change account details.", 
    examples: ["I forgot my password"], 
    parent: "account" 
  },
  question: { 
    what: "A question about the store itself: policies, shipping, opening hours.", 
    not_for: "a question about one of their own orders", 
    examples: ["do you ship to Canada?"] 
  },
};

const r = await run(
  client, 
  classify(text, INTENTS, { backoffBelow: 0.9 })
);

r.value;       // "where_is_it", …, or "none"
r.confidence;  // 0–1
r.level;       // "parent" when confidence was under 0.9 and the label has one; then r.parent is "orders"
```

Three things in how the labels are written come from our evals of this method, and they matter
more than anything else on this page:

- **Each label has a couple of real examples.** Descriptions alone mostly made Jev *surer* without
  making it much more *accurate*; two examples per label raised accuracy on both of the public
  intent sets we measured and cut confident wrong answers by nearly half. Use things customers
  have actually written.
- **Look-alikes get a `not_for`.** `cancel` and `return` are confused in both directions, so each
  says what the other is. Write these for the pairs you see confused, not for every label.
- **Labels have a `parent`, and the call sets `backoffBelow`.** When Jev can't separate two
  children, the parent is still right, and a message sorted to "orders, unsorted" is better than one
  sorted to the wrong child. One flat Choice with parents for back-off did far better in our evals
  than a tree walked level by level, so that's what `classify` does.

## 2. The order number: `extractValue`

Jev can't write out a value, and we wouldn't want it to: an order number it made up would look
exactly like a real one. `extractValue` has code find every candidate first (a pattern, or a list
of known names), and asks Jev only *which* candidate plays the role.

```ts
import { extractValue } from "question-kit";

const n = await run(client, extractValue(text, { kind: /\b\d{7}\b/g, role: "the customer's order number" }));
n.value;       // "4410982", or null: always text that's really in the message
n.candidates;  // what the pattern found; with none, nothing is asked and value is null
```

Over-finding is fine. The pattern here matches any seven digits, so a phone number or a tracking
code would be a candidate too; the question Jev answers is which one is the order number, which is
the part a pattern can't do. Built-in kinds (`email`, `phone`, `amount`, `number`, `zip`) come with
normalizers (lowercased emails, digits-only numbers).

## 3. The date: `extractDate`

Dates come in pieces ("last Friday", "10/02", "September 20") and the pieces are what Jev reads:
one Choice per part (month, day, year, weekday, "last" or "next", counted from today…), in one
request. Code puts the parts together on the calendar.

```ts
import { extractDate } from "question-kit";

const d = await run(client, extractDate(text, { role: "the date the customer gives for their order", today: "2026-10-07", expect: "past" }));
d.date;     // "2026-10-02", or null when the message gives no date
d.review;   // true when a person should check: the parts were unsure, or didn't make a date
d.note;     // why, when review is true
```

Two options do real work. `today` anchors everything relative, and the example fixes it so runs
are repeatable (and replay from the cache). `expect: "past"` picks the year when the text gives none:
"September 20" written in October 2026 means 2026, but written in January it would mean the year
before, and that's a decision for the code, not the model.

The triage uses the date only when `review` is false; a date Jev wasn't sure of is worse than no
date in the queue.

## 4. Should a person take it: `screen`

The last question about the message is whether it should skip the queues altogether. `screen`
asks one yes/no (Noul) question per flag, each phrased so that *yes* means the flag applies, and
applies a policy in code: act on a flag at or above one probability (0.7 by default), mark the
message for review at or above a lower one (0.35), and when several flags fire, take the most
serious action.

```ts
import { screen } from "question-kit";

const s = await run(client, screen(text, 
  {
    wants_person: { 
      statement: "The customer asks to talk to a person rather than an automated system.", 
      action: "person" 
    },
    will_leave: { 
      statement: "The customer says they will stop shopping with the store, or threatens to.", 
      action: "retain" 
    },
  }, 
  { precedence: ["person", "retain"] }
));

s.action;     // "person" | "retain" | "review" | "pass"
s.triggered;  // which flags fired, how likely each was, and what it called for
```

Write each statement as a plain claim about the text that's true when you want to act. "The
customer is upset" is a worse flag than "the customer asks to talk to a person": the second is
something the text either does or doesn't do.

## 5. Everything about one message in one request: `runAll`

Four methods, four questions about the same text. TypeSafe's guidance is to ask everything about
one state in one request, and the methods are built for that: each returns a *task* (its state
parts, its questions, and a reader for the answers), and `runAll` sends a set of tasks together.
Each task's questions are prefixed with its name, and text that several tasks were given is sent
once. Here the message goes in the state under a name of our own, and each task points at it with a `Ref`:

```ts
import { ref, runAll, type SystemOneCall } from "question-kit";

const log: SystemOneCall[] = [];
const message = ref("message");
const r = await runAll(client, 
  {
    intent: classify(message, INTENTS, { backoffBelow: 0.9 }),
    order: extractValue(message, { 
      kind: /\b\d{7}\b/g, 
      role: "the customer's order number", 
      source: text 
    }),
    date: extractDate(message, 
      { 
        role: "the date the customer gives for their order", 
        today: TODAY, 
        expect: "past" 
      }),
    flags: screen(message, FLAGS, { precedence: ["person", "retain"] }),
  }, 
  { 
    state: { message: text }, 
    log, 
    title: "triage", 
    about: { 
      intent: "which queue", 
      order: "order number", 
      date: "the order's date", 
      flags: "escalation" 
    }
  }
);

r.intent.value; 
r.order.value; 
r.date.date; 
r.flags.action;
```

`extractValue` takes a `source` here because, with a `Ref`, it can't see the text to find
candidates in; the other methods just point at it. The `about` option is a label per task, kept
with the request's metadata and never sent to Jev: it's for reading the log later. Question ids
aren't sent either; Jev sees the state and the question bodies, nothing else.

One request per message is also what makes this cheap. The six messages in the example cost a
small fraction of a cent together; the `log` collects every request with its answers and timing,
and `estimateCost(log)` prices it.

## 6. A question for the FAQ: `search`

A message sorted to `question` gets one more step. The FAQ is a list of lines; `search` asks one
Choice over the lines ("which line answers this?") and one Noul ("does any line answer it?"), and
turns the pair into a verdict. It needs its own request, so it takes the client rather than
returning a task.

```ts
import { search } from "question-kit";

const found = await search(client, FAQ, text, { log });
found.verdict;   // "answered" | "partly" | "not found"
found.answered;  // the probability that some line answers it
found.lines[0];  // the best line, with its probability
```

Only "answered" sends an auto-reply. The usual way this method fails is a question that's *on the
topic* of a line without being answered by it ("do you ship to Mexico?" against a line about
Canada), so the existence question is written against exactly that, and the default threshold
for "not found" is set from measurements rather than taken from the cookbook. If the FAQ changes
character, measure a few dozen questions with answers and set `absentBelow` from them.

## 7. Acting on the readings

Every reading came back with a probability or a confidence, and nothing above acted on one yet.
The code that does is short, and it's where the triage's behaviour lives:

```ts
if (r.flags.action === "person") return queue("a person", "asks for a person");
if (r.flags.action === "retain") return queue("retention", "says they'll leave");
if (r.flags.action === "review") return queue("a person", "might need one");
if (r.intent.value === "question") return (await search(client, FAQ, text)).verdict === "answered" ? queue("auto-reply") : queue("a person");
if (r.intent.value === "none") return queue("a person", "fits none of the intents");
if (r.intent.level === "parent") return queue(`${r.intent.parent} (unsorted)`, "intent unsure");
if (needsOrder(r.intent.value) && !r.order.value) return queue("ask for the order number");
return queue(r.intent.value);
```

The order of the checks is a policy: escalation outranks the queue, a question goes to the FAQ
before anything else, and an unsure intent goes to the parent's queue rather than to a guess. Each
line also records *why*, which is what a person looking at the queue needs more than the
probabilities.

Where do the thresholds come from? `backoffBelow: 0.9` and `screen`'s policy are starting points;
the right values depend on what a wrong sort costs you against a slow one. The way to set them is
the same for every method: run a few dozen messages you know the answer to through the cache,
look at the confidences of the wrong ones, and put the gate where it separates them. The log and the
`Recorder` (see the [package README](../../packages/question-kit/README.md#recording-gate-decisions))
are there for that.

## 8. Running it again for free

Everything above went through a `cachedJev`:

```ts
import { cachedJev } from "question-kit/cache";
import { typesafeJev } from "question-kit/typesafe";

const client = cachedJev(typesafeJev(), ".cache/jev");                  // record: ask once, keep the answer
const replay = cachedJev(undefined, ".cache/jev", { mode: "replay" });  // never calls the API; a miss throws
```

The cache is keyed by what the model sees (the state and the question bodies), so re-running the
program, or a test built on the same messages, costs nothing and gives the same readings. That's
how the example's `--replay` flag works, and how you can change the code around the questions
(the thresholds, the queue policy) and see the effect without asking Jev again. Change a question's
wording and that request is new, which is what you want: a changed question is a different
measurement. For unit tests that shouldn't touch the network at all, `fakeJev` answers from a
function you write.

## What to take from it

- Each method is one closed question (or one batch of them) plus code on both sides: code narrows
  what's asked (candidates, lines, flags), Jev gives probabilities, code decides.
- Ask everything about one text in one request with `runAll`.
- Spend your effort on the labels and statements: examples, `not_for`, parents. That's where the
  accuracy is.
- Act on confidence, with thresholds set from your own data, and keep the reason with the
  decision.
- Cache from the first run, so the second one is free.

The [service agent](service-agent.md) tutorial takes the same pieces and puts a conversation
around them.
