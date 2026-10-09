# question-kit

**Building kits for System One models.** For now that means [Jev](https://docs.typesafe.ai),
TypeSafe's; see [model support](#model-support).

> **Alpha.** question-kit is a prototype, and its APIs will change between 0.x releases. Please try
> it and tell us what breaks or feels awkward: [open an issue](https://github.com/Engid/question-kit/issues).
> We're not taking pull requests yet; if you'd like to contribute, open an issue first so we can
> talk it over.

Jev doesn't write text. You send it some state and a batch of closed questions ("which of these
options?", "yes or no?"), and it returns a probability for every option: a fast, cheap classifier. That makes it a good fit for the decisions inside an application, as long as the
questions are well written and the code around the answers is right. question-kit is that part:
a service agent you configure, and the building blocks it's made of.

## The service agent

Describe a service as data (what customers come for, what to collect, the tools your system
offers, the steps for each request) and `question-kit/service-agent` runs the conversation turn
by turn. Code runs the procedure; Jev reads the customer: what they want, the values a step needs,
their answers, and the judgment calls the written procedure leaves open. No language model writes
anything, and every reading passes a confidence gate before the agent acts on it.

```ts
import { defineService, turn } from "question-kit/service-agent";

const shop = defineService({
  intents: {
    order: { name: "Order food", description: "The customer wants pizza or drinks.", examples: ["can I get a large pepperoni?"] },
    hours: { name: "Opening hours", description: "The customer asks when the shop is open.", aside: true },
  },
  slots: {
    items: { label: "order", menu: pizzaMenu() },    // read by question-kit/order
    line: { label: "item", from: "order" },         // one of the lines the register reported
    phone: { label: "phone number", pattern: "phone" },
  },
  tools: {
    "add-items": { description: "add items to the order", needs: ["items"] },
    "change-item": { description: "change an item already on the order", needs: ["line", "items"] },
    "remove-item": { description: "take an item off the order", needs: ["line"] },
    "place-order": { description: "send the order to the kitchen", needs: ["phone"], changes: true },
  },
  procedures: {
    order: [{ repeat: ["add-items", "change-item", "remove-item"], ask: "What can I get for you?" }, "place-order"],
    hours: [{ say: "We're open 11am to 11pm every day." }],
  },
});

const said: string[] = [];
let r = await turn(shop, log, { type: "customer", text: "two large pepperoni pizzas and a diet coke" }, { client });
said.push(...r.messages);
while (r.action.type === "call") {
  // The app owns the order: run the tool, tell the agent what happened.
  r = await turn(shop, r.log, { type: "result", tool: r.action.tool, step: r.action.step, ...register.run(r.action.tool, r.action.values) }, { client });
  said.push(...r.messages);
}
said; // ["Got it: 2 large pizzas with pepperoni.", "And 1 diet coke.", "Anything else?"]
```

That's the whole [pizza shop](examples/pizza-shop/README.md): a counter where you order over a
few messages, change your mind ("actually put mushrooms on the pizzas, and take off the coke"),
and get an order number, with Jev's reads shown beside the chat. Run it in the terminal or as a
web page:

```sh
bun install
echo "TYPESAFE_API_KEY=..." > .env
bun run pizza                # the terminal chat; --trace prints every question Jev was asked
bun run pizza:web            # the same counter at http://localhost:8787
bun run pizza --fake         # no key: a rule-of-thumb stand-in answers, to see the screen
```

```
 You    two large pepperoni pizzas and a diet coke

 ┊ Jev  intent → order  0.97 ✓
 ┊ Jev  "two large pepperoni pizzas" → add (2 large pizzas with pepperoni)  0.94 ✓
 ┊ Jev  "and a diet coke" → add (1 diet coke)  0.94 ✓
 ┊ Jev  done ordering? → no  0.94 ✓
 ⚙ Register  add-items: added 2 large pizzas with pepperoni
 ⚙ Register  add-items: added 1 diet coke
 ┊ Jev  check → nothing looks wrong  P(wrong) 0.02

 Agent  Got it: 2 large pizzas with pepperoni. And 1 diet coke. Anything else?
```

The agent was built and measured on ABCD, a public set of customer-service chats: on 200 held-out
chats, against a scripted customer built from each recorded chat, it finished 77.5% with the right
changes and made no wrong change; the same agent with simple rules in place of Jev finished 47.0%.
That's one dataset and a scripted customer. The [guide](docs/service-agent.md) has the rest:
slots, tools, procedures, what a turn does, and [how the agent decides](docs/how-the-agent-decides.md).

## The building blocks

Underneath are two more entries, usable on their own.

**`question-kit`**, the core: ready-made methods for the jobs people most often give Jev, each
writing its own questions and returning a typed result with a confidence.

```ts
import { classify, extractDate, extractValue, pickOne, run } from "question-kit";

await run(client, extractValue("about order 4410982, zip 94110", { kind: "number", role: "the order number" }));
// { value: "4410982", … }: always text that's really in the message
await run(client, extractDate("it was due last Friday", { role: "the date it was due", today: "2026-10-07" }));
// { date: "2026-10-02", … }: Jev reads the parts, code does the calendar
await pickOne(client, "the blender still hasn't come", customerOrders, { noun: "order" });
// { value: "4410982", … }, or null when none of them fits
```

`classify`, `classifyTree`, `pickOne`, `extractValue`, `extractDate`, `callFunction`,
`verifyRecord`, `checkClaim`, `search`, `rerank`, `matchRecords`, `screen`, `filterPassages`,
`recoverStructure`, `rubric`, `featurize`, `stability`: each follows one of TypeSafe's
[cookbooks](https://docs.typesafe.ai/cookbooks). The [package README](packages/question-kit/README.md)
has every one with examples, and the pieces they're made of: named state parts, question helpers,
readings with TypeSafe's confidence formulas, a lint that catches badly formed questions before
anything is sent, a cache, and a client for TypeSafe's API with retries and pacing.

**`question-kit/order`**: an order from one message, for any menu you describe. Code looks every
word up in the menu, Jev tags the rest, code assembles the items, and Jev checks the result read
back against what the customer said. With the menu of Amazon's
[PIZZA benchmark](https://github.com/amazon-science/pizza-semantic-parsing-dataset), it got 95.1%
of 1,357 test orders exactly right (the benchmark paper's best trained model: 78.6%), for about
$1.43 per 1,000 orders; one benchmark, in English, with jev-1.13. The
[package README](packages/question-kit/order/README.md) has the menu format and every option.

## Install

```sh
npm install question-kit @typesafe-ai/sdk
```

One package, three entries: `question-kit` (the building blocks), `question-kit/service-agent`
and `question-kit/order`, plus `question-kit/typesafe`, `question-kit/cache` and
`question-kit/node`. Node 20 or later, or Bun; plain ES modules with type declarations; all of it
bundles for the browser except the `node` and `cache` entries. `@typesafe-ai/sdk` is an optional peer, used by `question-kit/typesafe`. Calls to Jev
need `TYPESAFE_API_KEY`; `question-kit/cache` keeps answers on disk so re-runs are free.

## Docs

The guide is Markdown in [`docs/`](docs/index.md): [getting started](docs/getting-started.md),
[building an agent](docs/service-agent.md), [the pizza shop, step by step](docs/pizza-shop.md),
[how the agent decides](docs/how-the-agent-decides.md), and
[the building blocks](docs/building-blocks.md). A docs site is coming at questionkit.dev.

## Model support

For now, question-kit works with Jev only. We haven't compared decision models ourselves, but
published comparisons suggest Jev's probabilities are among the better calibrated (one
[study](https://arxiv.org/abs/2610.06625) found them better calibrated than GPT-6 Luna's token
probabilities, though not consistently better than an open-weight Qwen model's). Other System One
models may come later, each measured the same way.

## What we found

The designs come from measured experiments on two public answer keys: dependency parsing (UD
English EWT) and pizza orders (PIZZA), and on ABCD's customer-service chats. The experiments live
in a research repo that isn't public; earlier versions are in this repo's history.

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
- **Read values with the conversation in view.** The agent's own question is what makes a bare
  number an order ID: 98.6% of values right with the agent's lines, 93.2% without.

## What's next

Measuring the core methods on real data; the service agent on live chats; delivery for the pizza
shop; the docs site; and more kits as they're measured. Ideas and requests: open an issue.

## What's where

```
packages/     the question-kit package: core/, order/ and service-agent/, one entry each
examples/     the pizza shop (terminal and web), an outdoor store's support chat, a one-message order taker
docs/         the guide, as Markdown
smoke/        a few live checks per core method
test/         offline unit tests
```

```sh
bun install
bun run typecheck && bun test        # offline
bun run build                        # dist/ for the package
bun run smoke --client record        # the core methods' live checks (59 requests, about $0.002)
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: issues are the way in during the alpha, pull
requests after a conversation.

## License

MIT. Nothing here includes or downloads a dataset; the numbers quoted from benchmarks were measured
in our research repo. The idea of parsing and taking orders with closed questions builds on
Stately's [jevspresso](https://github.com/statelyai/jevspresso) demo; no code is copied from it.
