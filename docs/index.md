---
layout: home

hero:
  name: question-kit
  text: Building kits for System One models
  tagline: The questions, written well, and the code around the answers. For Jev, from TypeSafe.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Build a service agent
      link: /tutorials/service-agent
    - theme: alt
      text: GitHub
      link: https://github.com/Engid/question-kit

features:
  - icon: { src: /parts/service-agent.svg, width: 150, height: 128 }
    title: A service agent you configure
    details: Describe a service as data (what customers come for, what to collect, the tools, the steps) and it runs the conversation turn by turn. Code runs the procedure; Jev reads the customer. No language model writes anything, and every reading passes a confidence gate first.
    link: /service-agent
    linkText: question-kit/service-agent
  - icon: { src: /parts/order.svg, width: 150, height: 128 }
    title: An order taker
    details: One message in, a structured order out, for any menu you describe, plus whether to trust it. Code reads what the menu knows; Jev tags the rest and checks the result.
    link: /building-blocks#the-order-taker
    linkText: question-kit/order
  - icon: { src: /parts/core.svg, width: 150, height: 128 }
    title: The building blocks
    details: Seventeen ready-made methods that write their own questions (classify, pick one of many, extract a value or a date, check a record, search, screen and more), each returning a typed result with a confidence.
    link: /building-blocks
    linkText: question-kit
---

> [!WARNING]
> **Alpha.** question-kit is new, and its APIs will change between 0.x releases. Please try it and tell us
> what breaks or feels awkward: [open an issue](https://github.com/Engid/question-kit/issues).
> We're not taking pull requests yet; if you'd like to contribute, open an issue first so we can
> talk it over.

## What it's for

Jev doesn't write text. You send it some state and a batch of closed questions ("which of these?",
"yes or no?") and it returns a probability for every option, fast and cheaply. That makes it a good
fit for the decisions inside an application: what a customer wants, which line of an order they
mean, whether a form is filled in right.

The hard part is writing the questions well and fitting code around the answers. question-kit does
that part:

```ts
import { classify, run } from "question-kit";

const intent = await run(
  client,
  classify("where is my package? it was due Friday", {
    shipping: "Where an order is, or when it will arrive",
    refund: "Money back for an order",
    account: "Logging in, passwords, account details",
  }),
);

intent.value;      // "shipping"
intent.confidence; // 0.97
```

The methods follow TypeSafe's [cookbooks](https://docs.typesafe.ai/cookbooks), which we recommend
reading: each is a recipe for getting one kind of answer out of Jev, and question-kit turns the
recipes into functions you call with a little structured state.

For now question-kit works with [Jev](https://docs.typesafe.ai) only. We haven't measured other
decision models yet, and want to before supporting them.

## Where to go next

- **[Getting started](getting-started.md)**: install, connect Jev, ask a first question.
- **Tutorials**, start to finish:
  - [Sort a support inbox](tutorials/triage.md): five core methods composed into one request per
    message.
  - [Build a service agent](tutorials/service-agent.md): the service description, written in the
    order the needs come up.
- **[Building an agent](service-agent.md)**: the reference for the service description, one turn,
  and the loop. [The pizza shop](pizza-shop.md) shows all of it at a counter.
- **[How the agent decides](how-the-agent-decides.md)**: gates, confidences, and what happens when
  Jev isn't sure.

> [!TIP]
> **Building with a coding agent?** The package ships a skill for it: `skills/question-kit/SKILL.md` in
> `node_modules/question-kit/` after an install, or `npx skills add Engid/question-kit`. It tells
> an agent how to think in Jev's questions, which method to reach for, and the traps.
