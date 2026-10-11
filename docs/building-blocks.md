# The building blocks

`question-kit`, the package's main entry, is what the kits are made of: ready-made methods for the jobs
people most often give Jev, and underneath them the pieces for writing your own questions. The
[package README](https://github.com/Engid/question-kit/blob/main/packages/question-kit/README.md) has
every method with examples and options; this page is the map.

## The shape of a method

Each method is a function that returns a *task*: the state parts it needs, the questions it
asks (written for you, pointing at the state by path), and a reader that turns Jev's answers
into a typed result with a confidence.

```ts
import { classify, extractDate, run, runAll } from "question-kit";

const r = await run(client, extractDate("it was due last Friday", { role: "the date it was due", today: "2026-10-07" }));
r.date; // "2026-10-02": Jev reads the parts ("last", "Friday"), code does the calendar
r.confidence;

const both = await runAll(client, {
  intent: classify(text, labels),
  due: extractDate(text, { role: "the date it was due", today }),
});
```

`run` sends one task; `runAll` sends several about the same state in one request, which is how
TypeSafe recommends asking everything about one state (one request is faster than several, and
Jev answers each question independently). Text that several tasks were given is sent once. Methods
that need more than one request (a pick among many, a search) take the client and return a promise.

## The methods

| Method | What you get | Requests | Follows TypeSafe's cookbook |
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
| `stability`, `band` | how much answers move between repeats; an "uncertain" band | repeats | Self-consistency |

Every value `extractValue` returns is text that's really in the input: code finds the candidates
(a pattern, a list of names) and Jev picks which plays the role, so there's nothing to hallucinate.
`extractDate` works the same way on the parts of a date.

Each method has offline tests, a few live smoke checks, and an eval of its own in our internal
set: public labeled data where a public set fits the task (intent sets with out-of-scope queries,
reading-comprehension questions with unanswerable ones, matched product records) and cases we
wrote where none does, with Jev's answers cached so every change is measured on the same inputs.
What those evals taught, in the code:

- **One Choice beats a walk.** `classify` with the leaves as labels and their parents for back-off
  was right far more often than `classifyTree` on a two-level intent set; use the tree only when
  the leaves don't fit in one Choice. The same held for `pickOne` against `classify` with a "none"
  option; `pickOne`'s gate questions did little, its fit check does the work, so its threshold is
  the one to tune.
- **Thresholds come from data, not the cookbooks.** `verifyRecord` flags at 0.8 (as many planted
  errors caught as at 0.7, half the false alarms); `search` calls a question unanswered under 0.5,
  with its existence question rewritten against the usual failure, lines on the topic without the
  answer; `pickOne` picks nothing when the best fit is under 0.7.
- **Dates come in more shapes than the cookbook's seven parts.** Customer messages count from today
  ("in three days", "two weeks ago"), name a month's end, and give a bare day of the month;
  `extractDate` asks for those parts too.
- **A block can't be typed alone.** With the markers gone, a list of full sentences looks like
  paragraphs one block at a time; `recoverStructure` also asks whether each pair of neighbours are
  entries of the same list and types the run together.

## Underneath

For questions of your own:

- **State**: `ref("message")` points at a part of the state the caller provides; `q` writes
  instructions with backticked paths (`` q`Is ${at("text")} a complaint?` ``), the way TypeSafe's
  docs recommend referring to state.
- **Questions**: `choice(instructions, options, { none })`, `noul(statement)`, `score(levels)`.
  Options are described (`{ what, not_for, examples }`), so look-alikes are told apart.
- **Readings**: `readChoice`, `readNoul`, `readScore` give a value, a probability and a
  confidence by TypeSafe's formulas; `decide(reading, cuts)` turns one into act / confirm / person
  with per-option cut-offs; `band` marks the uncertain middle.
- **Tasks**: `check`, `checks`, `choose`, `rate` are the one-question tasks; `nest` and `place`
  put a task's parts under a name in a bigger state.
- **Lint**: `lint` checks a request before it's sent, by TypeSafe's guidance: a backticked path
  that points at nothing in the state, a Choice with more than 255 options, a question with no
  instructions, a Noul asking two things at once, arithmetic left to the model. Errors stop the
  request (`run` refuses it); warnings come back for you to read.
- **Sending**: `send` splits a request that would be too big into several; `estimateTokens` and
  `estimateCost` price it.
- **Clients**: `typesafeJev()` (from `question-kit/typesafe`, retries and pacing included),
  `cachedJev()` (from `question-kit/cache`, record and replay), `fakeJev()` for tests.
- **Recording**: a `Recorder` gets every gate decision; `question-kit/node` has the one that writes
  a file.

## The order taker

`question-kit/order` takes an order from one message, for any menu you describe:

```ts
import { defineMenu, takeOrder } from "question-kit/order";

const cafe = defineMenu({
  name: "coffee",
  place: "a coffee counter",
  items: { drink: {}, pastry: {} },
  fields: {
    drink: { items: ["drink"], names: true, values: { LATTE: ["latte", "lattes"], AMERICANO: ["americano"] } },
    size: { items: ["drink"], values: { SMALL: ["small"], LARGE: ["large", "big"] } },
    extras: { items: ["drink"], many: true, amounts: true, values: { SHOT: ["shot", "espresso shot"], FOAM: ["foam"] } },
    pastry: { items: ["pastry"], names: true, values: { CROISSANT: ["croissant", "croissants"] } },
  },
});

const order = await takeOrder("a large latte with an extra shot and no foam and two croissants", cafe, client);
order.readBack; // ["1 large latte with extra shot and no foam", "2 croissants"]
order.accept;   // true when every check answer says the order is probably right
order.confirm;  // otherwise, which items to read back, and whether to ask "anything else?"
```

Code looks every word up in the menu; Jev tags the words the menu doesn't know, in one request;
code groups the tagged words into items; and Jev checks the finished order read back against what
the customer said, one question per item and one for "anything missing?", which is what decides
whether to accept the order or read it back. The design is the one that scored best in our evals
on thousands of single-message orders with written answers (pizza orders, in English); other menus
haven't been through evals yet.

The service agent uses it for menu slots, with the `partial` option that keeps the parts of a
message that change an order without naming an item ("a medium", "no onions").

The order taker is built from the methods above: `choose` for each word and for the pick between
two readings, `check` for the read-back, sent together with `runAll`. Its questions are written
out in full rather than taken from the defaults (each method takes its question as a function of
the text's `Ref`), so what it asks is exactly what was measured.
