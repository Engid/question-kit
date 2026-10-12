# question-kit

Building kits for System One models. For now that means [Jev](https://docs.typesafe.ai),
TypeSafe's: we haven't measured other decision models yet, and want to before supporting them.

> **Alpha.** question-kit is a prototype, and its APIs will change between 0.x releases. Please try
> it and tell us what breaks or feels awkward: [open an issue](https://github.com/Engid/question-kit/issues).
> We're not taking pull requests yet; if you'd like to contribute, open an issue first so we can
> talk it over.

Jev doesn't write text. You send it some state and a batch of closed questions ("which of these?",
"yes or no?") and it returns a probability for every option, fast and cheaply. That makes it a good
fit for the decisions inside an application: what a customer wants, which line of an order they
mean, whether a form is filled in right. The hard part is writing the questions well and fitting
code around the answers. question-kit does that part.

## What's in the box

- **A service agent you configure** ([`question-kit/service-agent`](service-agent.md)): describe
  a service as data (what customers come for, what to collect, the tools, the steps) and it runs
  the conversation turn by turn. Code runs the procedure; Jev reads the customer. No language
  model writes anything, and every reading passes a confidence gate before the agent acts on it.
  [The pizza shop](pizza-shop.md) is the walkthrough.
- **An order taker** ([`question-kit/order`](building-blocks.md#the-order-taker)): one message in,
  a structured order out, for any menu you describe, plus whether to trust it.
- **The building blocks** ([`question-kit`](building-blocks.md)): seventeen ready-made methods that
  write their own questions (classify, pick one of many, extract a value or a date, fill in a
  function call, check a record, search, screen, and more), each returning a typed result with a
  confidence, and the pieces they're made of.

The methods follow TypeSafe's [cookbooks](https://docs.typesafe.ai/cookbooks), which we recommend
reading: each one is a recipe for getting a kind of answer out of Jev, and question-kit's job is to
turn the recipes into functions you can call with a little structured state.

## Where to go next

- [Getting started](getting-started.md): install, connect Jev, run a first question.
- [Building an agent](service-agent.md): the service description, one turn, the loop.
- [How the agent decides](how-the-agent-decides.md): gates, confidences, what happens when Jev
  isn't sure.
- Tutorials: [sort a support inbox with the core](tutorials/triage.md), the methods composed one
  request at a time; [build a service agent](tutorials/service-agent.md), the description written
  in the order the needs come up.
- Building with a coding agent? The package ships a skill for it: `skills/question-kit/SKILL.md`
  in `node_modules/question-kit/`, or `npx skills add Engid/question-kit`.

Everything here is in the Markdown under `docs/` in the repository; a docs site at questionkit.dev
is coming.
