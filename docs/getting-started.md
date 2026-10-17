# Getting started

## Install

```sh
npm install question-kit @typesafe-ai/sdk
# or
bun add question-kit @typesafe-ai/sdk
```

One package, with an entry per kit:

| Entry | What it is |
| --- | --- |
| `question-kit` | the core: the building blocks |
| `question-kit/service-agent` | the service agent |
| `question-kit/order` | the order taker |
| `question-kit/typesafe` | a client for TypeSafe's API, with retries and pacing |
| `question-kit/cache` | an answer cache on disk, to record and replay |
| `question-kit/node` | Node-only helpers, like a recorder that writes a file |

TypeSafe's SDK is an optional peer: it's what `question-kit/typesafe` wraps, and you can leave it
out if you bring your own client.

It runs on Node 20 or later, or Bun. It's plain ES modules with type declarations, and the core, the
order kit and the agent all bundle for the browser.

> [!WARNING]
> Bundling for the browser doesn't mean calling Jev from it: the API key belongs on a server. The
> pizza shop's [web page](pizza-shop.md#the-web-page) shows the shape, with a small server that
> forwards the requests.

## Connect Jev

```ts
import { typesafeJev } from "question-kit/typesafe";

const client = typesafeJev(); // reads TYPESAFE_API_KEY
```

Everything in question-kit takes a `client`: any object with a `systemOne(request)` method that
returns Jev's answers (the type is `SystemOneClient`). Three come with it:

- **`typesafeJev()`** is TypeSafe's SDK with retries and pacing set for batch work.
- **`cachedJev(client, dir)`**, from `question-kit/cache`, keeps every answer on disk, so re-runs
  are free and repeatable.
- **`fakeJev(answer)`** answers from a function you write, for tests.

Other System One models, through OpenRouter, are [experimental](experimental.md).

## A first question

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

The confidence is TypeSafe's formula: how far the top probability is above an even spread, from 0
to 1.

`classify` builds one Choice question with your labels (and a "none" option, since a message may
fit none of them), points it at the text, sends it, and reads the answer back with its confidence.
The other methods work the same way: a function that returns a *task*; `run` sends it. Several
tasks about the same text go in one request with `runAll`, which is how TypeSafe recommends asking
everything about one state:

```ts
import { check, extractValue, runAll } from "question-kit";

const r = await runAll(client, {
  intent: classify(text, labels),
  order: extractValue(text, { kind: "number", role: "the order number" }),
  upset: check(text, "The customer is upset."),
});
r.order.value; // "4410982", always text that's really in the message
r.upset.value; // true or false, with r.upset.confidence
```

## Where to go next

- **[Sort a support inbox](tutorials/triage.md)**, a tutorial: five methods composed into one
  request per message, start to finish.
- **[Build a service agent](tutorials/service-agent.md)**, a tutorial, if you're here for the
  agent.
- **[The building blocks](building-blocks.md)**, for every method and the pieces underneath.
