# system-one-parsers

A lab for building a generic, domain-free dependency parser out of a System One model:
[Jev](https://docs.typesafe.ai) from TypeSafe AI. There's no LLM, no trained parser and no domain
knowledge. The parser asks Jev many small closed questions about each word, then assembles a
standard [Universal Dependencies](https://universaldependencies.org) tree from the answers in plain
code.

> **Status: work in progress.** The parser, the decoder and the eval harness work against the live
> API. The only Jev results so far are from one 125-sentence dev sample (below). This README only
> quotes numbers that a recorded run produced. The web demo, the coffee-order example and the
> write-up come next.

## How it works (strategy `head-selection`)

1. **Tokenize** (code). Evals use the treebank's gold words instead.
2. **Part of speech** (Jev). One Choice per word over the 17 UPOS tags. The `pos-hier` variant
   asks open/closed/other first, then the fine tag.
3. **Heads** (Jev). One Choice per word: "which word is the head of `words.wN`?" The options are
   every other word plus `root`.
4. **Decode** (code). Head probabilities become edge weights. The decoder takes the maximum
   spanning arborescence with exactly one root child (Chu-Liu/Edmonds), so the output is always a
   tree. Optional decode-time rules apply UD's conventions in code:
   - a mask that stops function words from being heads
   - re-attaching introducing function words (prepositions, subordinators, coordinators) to the
     word they introduce

   These rules use only Jev's existing answers, so they cost no extra requests.
5. **Relations** (Jev). For each decoded edge, a coarse Choice over relation groups and a fine
   Choice within each group. They're combined with TypeSafe's geometric-mean path rule.

Steps 2 and 3 share one request and step 5 is a second one. Variants change one thing at a time:
a single request, three stages with POS-based pruning, argmax instead of MST, reversed or both
option orders, no UD hints or a second version of them, and neighbor context. See
[`src/strategies/registry.ts`](src/strategies/registry.ts).

The questions surface Jev's *judgments*. They don't read its internal attention.

## Quick start

```sh
bun install
bun run fetch-ud          # UD English EWT r2.18 dev + test, SHA-256 checked (CC BY-SA 4.0; not redistributed here)
bun test                  # offline; never calls the API
```

### Evals

```sh
# Offline checks
bun run eval --client oracle    # answers from the gold tree: a plumbing check, should be 100%
bun run eval --client dry       # uniform answers, no network: shows questions and request size per sentence
bun run eval --strategies rules,adjacent --per-bucket 100000   # the rules-only floors on all of dev

# Live (needs TYPESAFE_API_KEY in .env). First one sentence, with every answer printed:
bun run smoke "The dog chased a red ball across the yard."
# Then a small sample (4 sentences: 2 of 1–5 words, 2 of 6–10; 8 requests):
bun run eval --client record --strategies head-selection,rules --per-bucket 2 --max-len 10
# Re-run the same thing for free from the cache:
bun run eval --strategies head-selection,rules --per-bucket 2 --max-len 10
```

`--client` options:

| Mode | What it does |
| --- | --- |
| `replay` (default) | Answers from cached Jev responses only and never calls the API. A sentence that isn't cached is skipped and reported. |
| `record` | Uses the cache, calls the API on a miss and saves the answer under `.cache/jev/`. |
| `live` | Calls the API without a cache. |
| `oracle` | Answers from the gold tree. |
| `dry` | Gives uniform answers. |

The other options are:

- `--per-bucket N`, `--max-len N`, `--limit N` and `--split dev|test` to choose the sample
- `--ids FILE` and `--exclude FILE` (e.g. an earlier run's `.ids` file, for a held-out sample), and `--seed N`
- `--unlabeled`, which skips the relation questions, so decode-only variants can be scored for UAS on cached head answers at no cost
- `--concurrency N`, `--label NAME` and `--worst N`

`bun eval/analyze.ts --strategies NAME [--unlabeled]` breaks head errors down from cached answers:

- by kind: inverted, too high, sibling
- by gold relation
- mutual first-ranked head pairs
- option position
- distance to the gold head

Each run prints:

- UPOS, UAS and LAS (CoNLL 2018 conventions: every word counts, and only the universal part of a
  relation is compared)
- a Jev diagnostics and cost table:
  - argmax UAS before decoding, and how many heads the decoder changed
  - mutual first-ranked head pairs
  - requests, questions, input tokens, latency and $ per 1,000 sentences
- UAS/LAS by sentence length
- a reliability table, with separation-based "flag this edge" precision and recall
- the worst sentences

It saves `results/runs/<run>.json`, one CoNLL-U file per strategy, and the sentence ids, so a
trained parser can be scored on the same sentences ([`baselines/`](baselines/README.md)).

**Cost and limits.** Request size grows with sentence length. The head question has an option
per word, and every word gets 8 relation questions. Measured with `--client dry`, the default
strategy sends about 25 KB of JSON per sentence of 1–5 words, 140 KB for 11–20 words and 550 KB
for 41+ words.

The first live run (5 sentences, 10 requests) counted about 2.9 JSON characters per Jev input
token. TypeSafe lists jev-1.13 at $0.042 per million input tokens, with output free, and a context
limit of 64k tokens per request ([models](https://docs.typesafe.ai/models.md), checked 2026-10-06).
So all of EWT dev (2,001 sentences, about 114 KB each on average) should cost roughly $3–4 per
strategy. That's an estimate, not a bill.

To stay under the context limit, a request whose estimated size passes 48k tokens is split into
several requests (`maxRequestTokens`). Each eval run prints measured tokens and cost per 1,000
sentences.

## Results

### First Jev sample (2026-10-06, jev-1.13.0)

125 EWT dev sentences (25 per length bucket, 2,550 words, gold words), from
`bun run eval --client record --strategies head-selection,head-selection:hints-v2,head-selection:argmax,rules --per-bucket 25`:

| strategy | UPOS | UAS | LAS | input tokens / sentence |
| --- | --- | --- | --- | --- |
| `head-selection` | 92.0% | 51.3% | 40.0% | 75,769 |
| `head-selection:hints-v2` | 91.8% | 52.4% | 40.6% | 77,464 |
| `head-selection:argmax` (no MST) | 92.0% | 50.1% | 40.4% | 76,395 |
| `rules` (no Jev) | 78.5% | 43.3% | 32.8% | 0 |

UAS falls with sentence length: 85.9% for 1–5 words, 71.7% for 6–10, and 47–52% from 11 words
up. There the rules floor gets 40–49%.

Error analysis of the same answers (`eval/analyze.ts`):

- **Distance.** Jev's top head is right for 86.6% of words whose gold head is adjacent, 40.4% at
  distance 2, and under 10% at distance 5 or more. When the gold head is far away, Jev still
  picks an adjacent word over half the time.
- **Convention.** Jev's heads look function-headed, the traditional way. A preposition attaches to
  what its phrase modifies: 57.6% of `case` words took their grandparent. A noun attaches to its
  own preposition: 61.7% of `obl` words were inverted. The same happens with subordinators and
  auxiliaries.
- **Mutual pairs.** Mutual first-ranked pairs (A → B and B → A) came to 15.7 per 100 words. The
  most common were case, aux, compound, amod and cop pairs. The hints v2 wording reduced them to
  13.0 and moved UAS by about one point.

**Decode-time conventions (not yet held out).** These variants reuse the same answers with the
relation questions skipped (`--unlabeled`), so they report UAS only:

| variant | UAS |
| --- | --- |
| `head-selection` | 51.3% |
| `head-selection:masked` (function words can't be heads) | 61.8% |
| `head-selection:masked-reattach` (+ function-word re-attachment) | 66.2% |

Both rules were written after looking at these 125 sentences. Treat them as in-sample until a
held-out sample confirms them. With POS and heads from the gold tree (`--client oracle`), the two
rules together cap UAS at 98.9% on all of dev.

### Rules-only floor, all of dev

The rules-only floor on all of EWT dev (2,001 sentences, gold words), from
`bun run eval --strategies rules,adjacent --per-bucket 100000`:

| strategy | UPOS | UAS | LAS |
| --- | --- | --- | --- |
| `rules` (lexicon tagger + nearest-plausible-head rules) | 77.2% | 44.3% | 33.7% |
| `adjacent` (each word → next word) | 0.2% | 29.7% | 0.6% |

One more offline check: with POS from the gold tree (`--client oracle`), the
`no-function-heads` pruning rule caps UAS at 99.1% on all of dev. About 0.9% of gold heads are
function words or punctuation that the rule removes.

## Layout

```
src/jev/          wire types, live/recording/mock/oracle clients, TypeSafe's confidence formulas
src/ud/           UPOS and relation inventories, CoNLL-U read/write
src/decode/       Chu-Liu/Edmonds with a single-root constraint
src/strategies/   head-selection (+ variants) and the rules-only floors
eval/             fetch, sample, score, report
baselines/        a Python script that runs Stanza on the same split (the only Python here)
test/             offline unit tests
```

## License

MIT for the code. UD English EWT is CC BY-SA 4.0 and is downloaded at eval time, not
redistributed. The parsing approach generalizes ideas from Stately's
[jevspresso](https://github.com/statelyai/jevspresso) demo. No code is copied from it.
