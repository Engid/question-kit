# Python (preview)

question-kit for Python is the first piece of the port: the core plumbing and a first set of
methods, on PyPI as [`question-kit`](https://pypi.org/project/question-kit/). The TypeScript package
is the full kit, and the rest is coming to Python.

> [!NOTE]
> **An early release (0.1).** APIs may change between 0.x releases. If something you need from the
> TypeScript side isn't here yet, [open an issue](https://github.com/Engid/question-kit/issues) so we
> know what to port first.

## What's supported where

| | TypeScript | Python 0.1 |
| --- | --- | --- |
| `classify`, `extractValue` / `extract_value`, `screen`, `rankByScore` / `rank_by_score` | ✓ | ✓ |
| `check`, `checks`, `choose`, `rate` | ✓ | ✓ |
| The other core methods (`pickOne`, `extractDate`, `search`, `verifyRecord`, `rankPairwise`, …) | ✓ | not yet |
| `run` / `runAll`, readings, lint, cost estimates | ✓ | ✓ (`run`, `run_all`) |
| TypeSafe client with retries | ✓ | ✓ |
| Answer cache | ✓ | ✓, the same files and keys |
| The order taker (`question-kit/order`) | ✓ | not yet |
| The service agent (`question-kit/service-agent`) | ✓ | not yet |
| Runs in the browser | ✓ | n/a |
| API style | async | sync |

The two build byte-for-byte the same requests (a test checks this against requests built by the
TypeScript package), so they share one answer cache: answers recorded by either replay in both,
and the same question gets the same answer in both languages.

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

The names follow Python's conventions (`extract_value`, `run_all`, `backoff_below=`), and options
are keyword arguments; otherwise the methods take the same inputs and return the same results as
their TypeScript versions, so the [building blocks](../building-blocks.md) page and the
[triage tutorial](../tutorials/triage.md) apply.

## Several questions in one request

```python
from question_kit import check, classify, extract_value, ref, run_all

r = run_all(client, {
    "intent": classify(ref("message"), labels, backoff_below=0.9),
    "order": extract_value(ref("message"), kind="number", role="the order number", source=text),
    "upset": check(ref("message"), "The customer is upset."),
}, state={"message": text})

r["intent"].value   # the label, or "none"
r["order"].value    # "4410982": always text that's really in the message
r["upset"].value    # True or False, with r["upset"].confidence
```

A `Ref` formats as its backticked path, so an f-string writes a question that points at the state:
`f"Which order in {orders} is {message} about?"`.

## Testing without Jev

```python
from question_kit import check, fake_jev, run
from question_kit.cache import cached_jev

fake = fake_jev(lambda qid, question, state: "yes")   # every Noul says yes
run(fake, check("hi", "It's a greeting.")).value      # True

client = cached_jev(typesafe_jev(), ".cache/jev")      # record: ask once, keep the answer
replay = cached_jev(None, ".cache/jev", mode="replay") # never calls the API; a miss raises
```

The package's [README](https://github.com/Engid/question-kit/tree/main/python) has the full list of
what's in this release, and a skill for coding agents ships in the repository at
`python/skills/question-kit-python/`.
