# question-kit for Python

**The standard library for System One models.** For now that means [Jev](https://docs.typesafe.ai),
from TypeSafe.

Built by measurement, not guesswork: the core methods are developed against thousands of labeled
cases, from public benchmarks and our own test sets, and tuned on what the results show.

> **Early release.** This is the first piece of the Python port: the core plumbing and a first set
> of methods. The [TypeScript package](https://www.npmjs.com/package/question-kit) is the full kit
> (every core method, the order taker and the service agent), and the rest is coming to Python. APIs
> may change between 0.x releases; [issues](https://github.com/Engid/question-kit/issues) welcome.

Jev doesn't write text. You send it some state and a batch of closed questions ("which of these?",
"yes or no?") and it returns a probability for every option, fast and cheaply. The hard part is
writing the questions well and fitting code around the answers. question-kit does that part: each
method writes its own questions, following TypeSafe's [cookbooks](https://docs.typesafe.ai/cookbooks),
and returns a typed result with a confidence.

## Install

```sh
pip install "question-kit[typesafe]"
```

Python 3.10 or later. The `typesafe` extra installs TypeSafe's SDK (`typesafe-sdk`), which
`question_kit.typesafe` wraps; leave it out if you bring your own client. Calls to Jev need
`TYPESAFE_API_KEY`.

## A first question

```python
from question_kit import classify, run
from question_kit.typesafe import typesafe_jev

client = typesafe_jev()  # reads TYPESAFE_API_KEY

intent = run(client, classify("where is my package? it was due Friday", {
    "shipping": "Where an order is, or when it will arrive",
    "refund": "Money back for an order",
    "account": "Logging in, passwords, account details",
}))

intent.value       # "shipping", or "none" when nothing fits
intent.confidence  # 0 to 1, by TypeSafe's confidence formula
```

Several questions about the same text go in one request with `run_all`, the way TypeSafe recommends:

```python
from question_kit import check, classify, extract_value, run_all

r = run_all(client, {
    "intent": classify(text, labels),
    "order": extract_value(text, kind="number", role="the order number"),
    "upset": check(text, "The customer is upset."),
})
r["order"].value   # "4410982": always text that's really in the message
r["upset"].value   # True or False, with r["upset"].confidence
```

## What's in 0.1

| | |
| --- | --- |
| **Methods** | `classify` (with back-off to a parent label), `extract_value` (email, phone, amount, number, zip, names, or your own pattern), `screen` (flags and a policy), `rank_by_score` (a list in order by levels you write) |
| **One-question tasks** | `check`, `checks`, `choose`, `rate` |
| **Plumbing** | state parts and `Ref`s, `choice` / `noul` / `score`, readings with TypeSafe's confidence formulas, `run` and `run_all`, pre-send `lint`, `estimate_cost` |
| **Clients** | `typesafe_jev()` (retries set for batch work), `cached_jev()` (record and replay answers on disk), `fake_jev()` for tests |

The API is synchronous for now.

### Compared with the TypeScript package

| | TypeScript | Python 0.1 |
| --- | --- | --- |
| Core methods | all of them | the four above, plus the one-question tasks |
| Order taker (`question-kit/order`) | ✓ | not yet |
| Service agent (`question-kit/service-agent`) | ✓ | not yet |
| Answer cache | ✓ | ✓, the same files and keys |
| Runs in the browser | ✓ | n/a |

The two build byte-for-byte the same requests (a test checks this against requests built by the
TypeScript package), so they share one answer cache: answers recorded by either replay in both.

## Testing without Jev

```python
from question_kit import fake_jev, run, check
from question_kit.cache import cached_jev

fake = fake_jev(lambda qid, question, state: "yes")       # every Noul says yes
run(fake, check("hi", "It's a greeting.")).value          # True

client = cached_jev(typesafe_jev(), ".cache/jev")          # record: ask once, keep the answer
replay = cached_jev(None, ".cache/jev", mode="replay")     # never calls the API; a miss raises
```

## Links

- Docs: [docs.questionkit.dev](https://docs.questionkit.dev) (the Python pages are under
  [Python](https://docs.questionkit.dev/python/))
- Source: [github.com/Engid/question-kit](https://github.com/Engid/question-kit), in `python/`
- TypeSafe's docs: [docs.typesafe.ai](https://docs.typesafe.ai)

MIT licensed. © 2026 Nick Gideo.
