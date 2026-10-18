# Experimental

Some parts of question-kit are released before they're held to the bar the rest is. They live
under `question-kit/experimental/…`, so the import line says what you're using.

## What experimental means

- **It can change or go away in any release, including a patch.** Changes are listed under an
  **Experimental** heading in the [changelog](https://github.com/Engid/question-kit/blob/main/packages/question-kit/CHANGELOG.md).
- **It isn't yet held to the stable parts' bar.** Stable parts have their own evals, docs examples
  that run as tests, and settled wording.
- **Each experimental part says why it's experimental** (below).
- **It graduates** when its evals exist and pass, what it depends on upstream is stable, and its
  docs examples run as tests. It then moves to `question-kit/<name>`. The old
  `question-kit/experimental/<name>` path keeps working for one more minor release, with a
  deprecation note.
- **Nothing warns at run time.** The import path and this page are the signal.
- **The stable parts never import from `experimental/`.**

## Other models, through OpenRouter

```ts
import { openRouter } from "question-kit/experimental/openrouter";

const client = openRouter({ model: "openai/gpt-6-luna-decisions" }); // reads OPENROUTER_API_KEY
```

[OpenRouter's Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request)
serves several System One models, Jev among them, behind the same request shape as TypeSafe's API.
`openRouter()` is a client for it, and everything in question-kit takes it like any other client.

**Why it's experimental:**

- OpenRouter labels the endpoint alpha (`/api/alpha/decisions`).
- question-kit is built and tuned on Jev. Other models get the same questions, wording and
  thresholds, with nothing adjusted for them, and we're still measuring how they do.

**We suggest Jev**, since question-kit is built and tuned on it. We've tested these models with it,
and they work reliably well:

| Model | OpenRouter id |
| --- | --- |
| Jev 1.13 (through OpenRouter) | `typesafe/jev-1.13` |
| GPT-6 Luna Decisions | `openai/gpt-6-luna-decisions` |
| Microsoft-Decision-1 | `microsoft/microsoft-decision-1` |
| Perplexity pplx-decider v1.1 | `perplexity/pplx-decider-v1.1-27b` |
| Clef | `cloudflare/clef` |

So far that testing has been limited, and more is needed. Every model gets the wording and
thresholds tuned for Jev, and models, hosts and prices change. Before you rely on a model, test it
on your own data.

One model can behave differently on different hosts, in price and in results. To pin a host, use
`provider: { order: ["<host>"], allow_fallbacks: false }`.

Other models in OpenRouter's [list of decision models](https://openrouter.ai/api/v1/models?output_modalities=decisions)
should take the same requests. Either we haven't tested them, or they didn't do well enough in our
tests to list here. If you try one, please
[tell us how it goes](https://github.com/Engid/question-kit/issues).

**What the client does:**

- **Retries** rate limits, server errors, timeouts and dropped connections, like `typesafeJev`.
  `retry` and `onRetry` work the same way.
- **Routing:** `provider` is passed to OpenRouter unchanged, for example
  `{ data_collection: "deny" }` for hosts that don't keep or train on requests, or
  `{ order: ["cloudflare"], allow_fallbacks: false }` to pin one host.
- **Question ids:** some hosts take only ids of up to 100 letters, digits, `_`, `.` and `-`. Other
  ids, such as `runAll`'s `<task>::<question>`, are renamed on the way out and back on the way in.
  Ids aren't part of what a model is asked, so the answers don't change.
- **Request limits:** some hosts take only so many questions or tokens per request (Clef's: 64
  questions, and from 16k to 64k tokens depending on the host). A request over a known limit is
  sent as several, each with the whole state, and the answers are put back together; the state is
  billed once per part. A host that says a request is too big gets it again in halves.
  `maxQuestions` and `maxTokens` set the limits yourself. Pinning a host (below) lets the client use
  that host's limit instead of the smallest. If a host says even one question is too big, the
  error's `kind` is `"too-big"`.
- **Errors before sending** (`kind: "request"`): a Noul whose criteria give only one side, which
  OpenRouter refuses. Give both sides, or neither.
- **Errors after** (`kind: "answer"`): a missing answer, or a Choice or Score answer without
  probabilities, since question-kit's readings need them.
- **Refusals** (`kind: "refused"`): some models decline a question instead of answering it, and
  OpenRouter then fails the whole request. These aren't retried, since asking again gets the same
  answer. A "none of these" option on a Choice that can have no right answer avoids most of them,
  and question-kit's methods add one where it applies.
- **Images:** not yet. TypeSafe's image questions are a different shape from OpenRouter's, so the
  client refuses them until OpenRouter takes Jev's.

**Caching:** with `cachedJev`, give each model its own folder (or set `model` on each request), so
answers from different models never share a key. For runs you want to repeat, pin a dated model id
where OpenRouter lists one. The response's `model` says which model answered.
