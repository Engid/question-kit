---
name: question-kit-python
description: Build with question-kit for Python (the `question-kit` package on PyPI, imported as `question_kit`), the standard library for Jev, TypeSafe's System One model. Use when writing Python that classifies, extracts values, screens or ranks text with Jev, or writes questions for Jev directly. Covers the mental model, the methods in the Python release, composing them in one request, testing with fakes and the cache, and the traps.
---

# question-kit for Python

`question_kit` is the Python port of question-kit (Python 3.10+, synchronous API). It's an early
release: the core plumbing and a first set of methods. The TypeScript package (`question-kit` on npm)
has the full kit; if a method below isn't here, it hasn't been ported yet, so don't import it.

## The mental model

Jev never writes text. A request is some **state** (text or JSON) and a batch of closed
**questions**, and each answer is a probability for every option:

- **Choice**: pick one option (`{"a": 0.9, "b": 0.1}`); add a "none" option when nothing may fit.
- **Noul**: how likely a statement is true (`0.93`); phrase it so that yes means the thing you want.
- **Score**: where the state falls on levels you write, lowest first (a probability per level).

Every method returns a **task** (its state parts, its questions, and a reader); `run(client, task)`
sends one, `run_all(client, {...})` sends several about the same text in one request. Each result
has a `value` and a `confidence` from 0 to 1. Code decides what to do with the confidence.

## Methods in this release

| Job | Call | Result |
| --- | --- | --- |
| which label fits | `classify(text, labels, backoff_below=0.9)` | `.value` (or `"none"`), `.confidence`, `.level`/`.parent` when it backed off |
| an exact value from the text | `extract_value(text, kind="number", role="the order number")` | `.value` (normalized) or None; always text that's really there |
| flags and what to do | `screen(text, flags, precedence=[...])` | `.action`, `.triggered`, `.flags` |
| a list in order | `rank_by_score(items, query=..., levels=[...])` | `.ranked` best first, each with `.item`, `.value` |
| one statement | `check(text, "The customer asks for a person.")` | `.value` (bool), `.probability` |
| several statements | `checks(text, {"a": "...", "b": "..."})` | dict of readings |
| one option | `choose(text, options)` | `.value`, `.ranked` |
| a level | `rate(text, "How urgent is it?", levels)` | `.value` (expected level), `.level` |

Labels and options are a string or `{"what": ..., "not_for": ..., "examples": [...]}`. Give each
label two real examples and a `not_for` for look-alikes; classify labels can also have a `"parent"`.
`extract_value` kinds: `"email"`, `"phone"`, `"amount"`, `"number"`, `"zip"`, a compiled
`re.Pattern`, `{"names": [...]}` or `{"candidates": [...]}`.

## Compose: everything about one text in one request

```python
from question_kit import check, classify, extract_value, ref, run_all

r = run_all(client, {
    "intent": classify(ref("message"), labels, backoff_below=0.9),
    "order": extract_value(ref("message"), kind="number", role="the order number", source=text),
    "upset": check(ref("message"), "The customer is upset."),
}, state={"message": text})
r["intent"].value, r["order"].value, r["upset"].probability
```

A `Ref` formats as its backticked path, so f-strings write questions that point at the state:
`f"Which order in {orders} is {message} about?"`. `extract_value` given a `Ref` needs `source=`.

## Clients and testing

- `typesafe_jev()` from `question_kit.typesafe` (needs `pip install "question-kit[typesafe]"` and
  `TYPESAFE_API_KEY`): TypeSafe's SDK with retries for batch work.
- `cached_jev(client, ".cache/jev")` from `question_kit.cache` records answers;
  `cached_jev(None, dir, mode="replay")` never calls the API and raises `CacheMissError` on a miss.
  The files and keys are the TypeScript package's, so one cache serves both.
- `fake_jev(lambda qid, question, state: ...)` for unit tests: return an option id, a probability,
  `{"level": n}`, or a full answer dict.

## Traps

- Expecting text back. Anything said to a user comes from your code.
- Leaving the question in the id. Ids aren't sent; instructions must hold the whole question.
- Asking Jev for dates, counts or sums. Read parts, compute in code.
- Negative Nouls ("is not spam"): phrase for yes = found.
- Treating a low confidence as "no". It's "unsure": ask again, back off, or hand off.
- Reusing thresholds unmeasured. Set them from a few dozen cases with known answers.
- Importing a method from the TypeScript docs that isn't in this release.
