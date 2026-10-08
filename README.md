# question-kit

**Generate system-one questions from your domain and state**

>[!WARNING] 
> **Active research.** This repo is in a prototype phase: the packages here are early, and their
> APIs will change as the research goes on. If you're interested in using them, or have a use case
> you think they'd fit, please open an issue and tell us; feedback is what we're after right now.

[Jev](https://docs.typesafe.ai), TypeSafe AI's System One model, doesn't write text. You send it
some state and a batch of closed questions ("which of these options?", "yes or no?"), and it
returns a probability for every option. It's a classifier. The work here is about how to turn a
task like taking an order into the right classification questions, and how code and Jev's answers
fit together around them.

## The pattern

Every design that worked here has the same shape:

```mermaid
flowchart LR
    D["<b>Your domain</b><br/>a menu: kinds of item,<br/>fields, ways to say each value"] --> C1
    D --> Q
    T["<b>The text</b><br/>“two large pizzas with<br/>extra cheese and a diet coke”"] --> C1
    C1["<b>Code</b><br/>looks up what it knows"] --> Q["<b>Jev</b><br/>closed questions about the rest,<br/>generated from the domain,<br/>pointing at parts of the state"]
    Q --> C2["<b>Code</b><br/>assembles the result"]
    C2 --> V["<b>Jev</b><br/>checks the result:<br/>is anything wrong?"]
    V --> R["structured data,<br/>plus whether to trust it"]
```

The questions point at named parts of the state (`words.w3`, `summary.i1`) and offer every option
the domain allows, each described ("Topping: green peppers; not the same as peppers"). Writing
those by hand is tedious and easy to get wrong. The goal of question-kit's **core** is to generate
them from your domain and state.

## Packages

question-kit is one repo with a package per job: the core, which generates the questions, and kits
for particular uses, side by side. The core is the main package, `question-kit`; kits are scoped
packages, like `@question-kit/order`. None is published yet.

### `question-kit`: the core (prototype)

Ready-made methods for common jobs, each writing its own questions and returning a typed result
with a confidence: `classify`, `pickOne` (which of many, or none), `extractValue`, `extractDate`,
`callFunction`, `verifyRecord`, `checkClaim`, `search`, `rerank`, `matchRecords`, `screen` and more.

```ts
import { extractDate, extractValue, pickOne, run } from "question-kit";

await run(jev, extractValue("about order 4410982, zip 94110", { kind: "number", role: "the order number" }));
// { value: "4410982", … }: always text that's really in the message
await run(jev, extractDate("it was due last Friday", { role: "the date it was due", today: "2026-10-07" }));
// { date: "2026-10-02", review: false, … }: Jev reads the parts, code does the calendar
await pickOne(jev, "the blender still hasn't come", customerOrders, { noun: "order" });
// { value: "4410982", … }, or null when none of them fits
```

The [package README](packages/core/README.md) has every method, with examples.
The methods have offline tests and a few live [smoke checks](smoke/README.md) each, but no
benchmark numbers yet.

### `@question-kit/order` (prototype)

Takes an order in one message, for any menu you describe:

```ts
import { defineMenu, takeOrder } from "@question-kit/order";

const cafe = defineMenu({
  name: "coffee",
  place: "a coffee counter",
  items: { drink: {}, pastry: {} },
  fields: {
    drink:  { items: ["drink"], names: true, values: { LATTE: ["latte", "lattes"], AMERICANO: ["americano"] } },
    size:   { items: ["drink"], values: { SMALL: ["small"], LARGE: ["large", "big"] } },
    milk:   { items: ["drink"], values: { OAT: ["oat", "oat milk"], WHOLE: ["whole milk"] } },
    extras: { items: ["drink"], many: true, amounts: true, values: { SHOT: ["shot", "espresso shot"], FOAM: ["foam"] } },
    pastry: { items: ["pastry"], names: true, values: { CROISSANT: ["croissant", "croissants"] } },
  },
});

const order = await takeOrder("a large oat latte with an extra shot and no foam and two croissants", cafe, jev);

order.readBack;  // ["1 large oat latte with extra shot and no foam", "2 croissants"]
order.accept;    // true when every check answer says the order is probably right
order.confirm;   // otherwise, which items to read back, and whether to ask "anything else?"
```

`jev` is any client with a `systemOne(request)` method; the
[package README](packages/order/README.md) shows one for TypeSafe's SDK, and every option.

**How it was measured.** The design comes from our experiments on pizza orders.
With the menu of Amazon's [PIZZA benchmark](https://github.com/amazon-science/pizza-semantic-parsing-dataset),
it got 95.1% of 1,357 test orders exactly right (the benchmark paper's best trained model: 78.6%),
for about $1.43 per 1,000 orders. Its check accepted 75.7% of orders without a read-back, and 7 of
the 66 wrong orders were among them. That's one benchmark of single-message pizza orders, in
English, with jev-1.13; other menus haven't been measured. The [pizza example](examples/order/pizza/README.md)
runs it on a small pizza menu of our own.

## Model support

For now, question-kit works with Jev only. We haven't compared decision models ourselves, but
published comparisons suggest Jev's probabilities are among the better calibrated (one
[study](https://arxiv.org/abs/2610.06625) found them better calibrated than GPT-6 Luna's token
probabilities, though not consistently better than an open-weight Qwen model's). We want to measure how each model does, and
find the best way to generate questions for whichever one you choose.

## What we found

Designed from measured experiments on two public answer keys: dependency parsing (UD English EWT)
and pizza orders (PIZZA). The experiments now live in a separate research repo that isn't public;
earlier versions are in this repo's history.

- **Let code handle structure; ask Jev to classify.** Jev labels words against a 171-option menu
  ~99% right, but picks "which of ~35 words does this one attach to" only half the time.
- **Code first, Jev for the gaps.** The menu's word lists plus rules got 93.3% of pizza orders
  right; asking Jev only about the words they didn't know took it to 95.1%.
- **Wording and examples matter most.** Rewording one design's questions took it from 8% to 69%
  of orders right; adding examples to each option took it from 73.2% to 84.5%.
- **Many yes/no questions multiply small errors.** 108 questions per pizza, each 95–99% right,
  gave 8% of orders fully right.
- **Have Jev check the finished result.** Reading the order back to Jev, one question per item and
  one for "anything missing?", is what decides when to accept an order.

## What's next

Measuring the core methods on real data, and more kits built on core. We'll add them here once
they've been measured.

## Try it

```sh
bun install
bun test                                  # offline unit tests
bun run smoke --client record             # the core methods' live checks (59 requests, about $0.002)
bun run order:pizza "two large pizzas with extra cheese and no onions and a diet coke"
```

Calls to Jev need `TYPESAFE_API_KEY` in `.env`; answers are cached, so re-running is free.

### `@question-kit/service-agent` (prototype)

A lightweight customer-service agent: you describe the service as data (intents, the values to
collect, tools, and each intent's steps, with the company's written procedure), and it runs a chat
turn by turn. Code runs the steps; Jev reads the customer (what they want, the values a step needs,
their answers) and makes the procedure's judgment calls (which optional step the written procedure
calls for, given what the tools found and what the customer said). Every reading passes a confidence
gate before the agent acts on it, and every change is read back to the customer first. No LLM writes
anything: replies come from templates and the company's own wording. The state is a plain log of the
conversation. See the [package README](packages/service-agent/README.md).

## What's where

```
packages/     the packages: core (question-kit), order (@question-kit/order) and service-agent
examples/     things built with them: a pizza order taker, a store's support chat
smoke/        a few live checks per core method
test/         offline unit tests
```

## Contributing

Issues are the best way in right now: questions, use cases, and places where the order taker gets
things wrong. We're not looking for feature pull requests yet; if you have an idea, open an issue
to discuss it first. Pull requests that fix a problem you hit in a real use case are welcome.

## License

MIT. Nothing here includes or downloads a dataset; the numbers quoted from benchmarks were measured
in our research repo. The idea of parsing and taking orders with closed questions builds on
Stately's [jevspresso](https://github.com/statelyai/jevspresso) demo; no code is copied from it.
