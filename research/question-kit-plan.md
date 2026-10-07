# question-kit: plan and notes

Working notes, not a promise: nothing here is built yet. Last updated 2026-10-07.

## What `core` is for

Building with Jev means turning a task into classification questions: a state with parts the
questions can point at (`words.w3`, `summary.i1`), and for each question the options the domain
allows, each described well. Today that's hand-written strings stitched to code by hand, which is
tedious, error-prone, and expensive to check (every wording change is a new paid run).
question-kit's `core` should generate those questions from a description of your domain and your
state, so the strings come out right by construction, and give you the tools to measure what you
built.

We'll extract it once two kits need it: `order-kit`, and `service-kit` for the use case below.

## Layout (decided 2026-10-07)

```
packages/
  core/          generates questions from a domain + state, the check pass, measuring (planned)
  order-kit/     menus, grouping rules, read-backs (today's order taker)
  service-kit/   intents, values like order numbers and dates, options from records (planned)
```

- One repo, `question-kit`. Each package is published separately under the `@question-kit` npm
  scope (`@question-kit/core`, `@question-kit/order-kit`, `@question-kit/service-kit`); none is
  published yet. The packages are Bun workspaces, so examples import them by name.
- Kits sit side by side and stay evaluators: they return structured results with probabilities.
  Routing between them (`service-kit` working out that a customer wants to order, then handing the
  message to `order-kit`) is left to the app, a state machine such as XState, or a workflow engine.
- When `order-kit` is rebuilt on `core`, `bun run order:pizza:verify` (the same questions on all
  1,705 pizza orders) is the regression test.

## Next use case: customer-service intake, as `service-kit` ("where's my order?")

One message from a customer, for example "hi, this is Dana, order 48213 still hasn't shipped" or
"where's my package? it was supposed to come tuesday". What comes out:

| What | How | What's new compared with the order taker |
| --- | --- | --- |
| **What they want** (track, change address, cancel, return, billing, talk to a person, none of these) | one Choice over a list of intents you can add to | a larger intent list; the order taker only has "ordering" |
| **Which order or shipment** | code looks up the caller's account (from caller ID, or an ID in the message), then one Choice over their recent orders, each described ("blender, ordered Oct 2, shipped") | options come from live data, not a fixed menu |
| **Identifiers and values**: order numbers, tracking numbers, names, phone numbers, emails, dates | Jev locates or picks; code parses into typed values | values Jev can't produce itself |
| **Is it right?** | read the request back to Jev ("asking where order 48213 is?"), as the order taker's check does | the same check, different domain |

Two TypeSafe cookbooks cover the values:

- [Pre-parsed value extraction](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook.md):
  a regex tuned to over-find proposes candidates (emails, phone numbers, amounts); Jev picks the
  one the question asks for, or "none"; code copies it verbatim and normalizes it, so the value
  can't be invented or have a digit transposed. Names have no reliable regex, so they need another
  source of candidates (our word tags, or the account's records).
- [Date extraction](https://docs.typesafe.ai/cookbooks/date_extraction_cookbook.md): seven Choice
  questions per date (absolute, relative to today, or none; month; day; year; today, tomorrow or a
  weekday; which weekday; this week or next), and code assembles the date from the parts that apply.
  A date's confidence is the lowest of its parts'; below 0.60, or if the parts don't make a date,
  it goes to a person.

Our own word-tag approach (Jev labels which words are the order number) is a third option to
compare against the cookbooks.

### Data

- [Banking77](https://huggingface.co/datasets/PolyAI/banking77) (CC BY 4.0): 13,083 single
  customer messages, each labeled with one of 77 banking intents (3,080 in the test split). Banking,
  not shipping, but a clean single-message test of a large intent list.
- [ABCD](https://github.com/asappresearch/abcd) (MIT; [paper](https://arxiv.org/abs/2104.00783)):
  over 10K human-to-human customer-service chats, 55 intents, annotated with values like order IDs,
  account IDs, names, phone numbers and addresses. Multi-turn: customers usually give identifiers
  when the agent asks, so single-message tests would use opening messages for intents and later
  turns for values. Not inspected yet.
- Caller ID gives a phone number in the state for free; code can use it to look up the account.
- Insurance claims would also fit, but we haven't found a public dataset with answers. It would
  need hand-written test messages (never real customer data).

### To do

- [ ] Inspect ABCD: which turns carry the intent and which carry values; how clean the annotations
      are; build single-message test items from it.
- [ ] Banking77: one Choice over the 77 intents. Estimate the cost from request sizes before
      running; dev-style split for designing, the test split once.
- [ ] Values: compare regex candidates + Jev pick (the cookbook), Jev word tags + code parsing (ours),
      and the date cookbook's per-part questions, on ABCD values.
- [ ] Options from data: "which of these orders?" over a customer's recent orders, with
      made-up account data, including the hard cases (two similar orders, no matching order).
- [ ] The read-back check for intake.
- [ ] Write down what `order-kit` and intake share, then extract `core` and build `service-kit` on it.

### Where the work goes (proposed)

A new branch off `main` once this round of restructuring is merged, and a new folder beside
`research/pizza/`:

```
research/intake/
  README.md     the questions, the data, and results as they come in
  banking77/    fetch, the 77 intents as options, run, explain
  abcd/         fetch, inspect, single-message test items
```

Banking77 first: every message has one label, and it's the plainest test of a long intent list.
Inspecting ABCD costs nothing (no Jev calls), so it can run alongside and decide what the value
experiments look like.

## Open questions

- **The tutorial** waits for `core`, and the examples may move onto it.
- **A routing helper** for passing a message from one kit to another, if a pattern shows up. Not
  before there's a routing framework to fit into.
- **A Python port**, run against the same recorded answers and tests. Not now.
- **Moving under a Magewind GitHub organization.** Not decided.

## What `core` should cover (from what we know so far)

- **Domain → options.** Names, other ways of saying them, and "not the same as" notes generated
  from the domain; optionally structured criteria with examples (they took the per-topping design
  from 73.2% to 84.5% of orders right).
- **Addressable state.** The `words.wN` / `items.iN` / `summary.iN` references generated and kept
  in step with the state, never typed by hand.
- **Code first.** Look up what the domain already knows; ask Jev only about the rest.
- **Intents.** A list you can add to, turned into one Choice with a "none of these" option.
- **Values.** Locate or pick spans, then parse them into typed values: dates, numbers, IDs.
- **Options from data.** Choices built at run time from records (a customer's orders).
- **The check pass.** Read the result back; one question per part, phrased so yes means wrong; a
  cut-off for accepting.
- **Measuring.** Request splitting, the answer cache, replay, an oracle that answers from the answer
  key, whole-result scoring, and cost estimates before spending.

## Later

- **Conversations**, with Jev as the evaluator: "is the customer adding, changing, confirming,
  finished?" Taskmaster-1's spoken coffee and pizza dialogs to measure against; a drive-through
  demo.
- **More TypeSafe patterns** to try: speculative fan-out, composite scoring, intent routing,
  self-consistency; and their hierarchical classification next to our result that one flat list
  beat a two-step menu.
- **Jev with a small, fast LLM**, for example the LLM extracts and Jev verifies, as in TypeSafe's
  [SDE cascade](https://docs.typesafe.ai/cookbooks/sde_cascade.md).
- **Other decision models.** OpenAI's [Decisions API](https://developers.openai.com/api/docs/guides/decisions)
  (public beta, announced 2026-10-06; `gpt-6-luna`, $0.10 per million input tokens against Jev's
  $0.042) has `predicate`, `choice` and `score` questions over shared input, close to Jev's
  `noul`, `choice` and `score`. Its docs make no calibration claim and suggest setting thresholds
  from your own labeled examples. Its shared input is text or messages rather than a structured
  state, so whether references like `words.w3` work the same needs checking. To do: map the request shapes; replay
  the pizza check questions on another model and compare how well its probabilities sort right
  from wrong orders; consider a router such as OpenRouter.
- **Run-to-run variation:** does Jev give the same answers to the same request?
  (`bun run order:pizza:verify --client live` measures it on the pizza dev orders.)

## Moved out of the public docs (2026-10-07)

Kept here so nothing is lost; Nick asked to keep unfinished plans private until they're done. The
links below are relative to `research/`.

### The tutorial outline (from the write-up's "Build your own order taker")

*Later.* The tutorial waits for question-kit's `core`, since that is what most people will build on. The outline as it stood for [`packages/order-kit`](../packages/order-kit/README.md):

1. Describe a menu with `defineMenu`: kinds of item, fields, and how customers say each value.
2. Connect Jev: a `JevClient` around TypeSafe's SDK, with a cache so re-runs are free.
3. Take an order with `takeOrder`, and read what it decided: the words, the items, the check.
4. Decide what to read back: `accept`, `confirm`, and choosing `readBackAt`.
5. Measure it: write a few dozen orders with their right answers, score whole orders, and look at
   the ones it gets wrong.
6. Improve it: more ways of saying things in the menu, `design: "every-word"` or `"pick"`, and the
   wording settings.

Until then: [`examples/order-kit/README.md`](../examples/order-kit/README.md) has the short
version, and the [library README](../packages/order-kit/README.md) documents every option.

### Next steps: conversations (from the write-up)

Everything above takes an order in one message. A drive-through is a conversation: "actually, make
that a medium", "what drinks do you have?", "anything else?", "that's all". That's the next phase,
and it isn't built yet:

- **A state machine around `takeOrder`, with Jev as the evaluator.** The conversation's states
  (taking the order, confirming, done) live in code; Jev answers closed questions about each new
  message: is the customer adding to the order, changing it, answering a read-back, or finished?
  Code decides what happens next. Stately's [jevspresso](https://github.com/statelyai/jevspresso)
  demo takes the other approach: its `@xstate/jev` package makes Jev the policy, picking the
  machine's next event. We'd rather complement that than compete with it, so our side is the
  evaluator: turning what the customer says into facts that any machine, XState's included, can
  act on.
- **Real conversations to measure against.** Google's
  [Taskmaster-1](https://github.com/google-research-datasets/Taskmaster) (CC BY 4.0) has 5,507
  spoken two-person dialogs, including 766 coffee orders and 970 pizza orders, with the drinks,
  sizes and other details annotated turn by turn. Its annotations have errors (a "cappuccino"
  tagged as a number of drinks), so it needs checking before it can score anything.
- **A drive-through demo.** Speech in, `takeOrder` on each turn, the read-back spoken out, and the
  order on screen.

### The README's "What's next" list (before it was shortened)

1. `service-kit`: customer-service intake ("where's my order?"): intents from a list you can add
   to, options from live data (the customer's orders), identifiers like order numbers, names and
   dates (located by Jev, parsed by code); measured on Banking77 and ABCD.
2. Extract `core` from what `order-kit` and `service-kit` have in common, and rebuild the kits on it.
3. Conversations: Jev as an evaluator ("is the customer adding, changing, confirming?"), alongside
   state machines like XState's.
4. Other decision models: review how questions written for Jev translate to other decision APIs,
   and whether their probabilities are reliable enough for the check pass.
