# Detailed report

This is the full record behind the [research write-up](README.md): how each experiment was run, every
result with its uncertainty, and what the numbers do and don't show. Terms are defined in the
[parsing guide's glossary](parsing/README.md#glossary).

**Contents**

1. [Setup common to both experiments](#1-setup-common-to-both-experiments)
2. [Experiment 1: dependency parsing](#2-experiment-1-dependency-parsing)
3. [Experiment 2: pizza orders](#3-experiment-2-pizza-orders)
4. [The order-kit library](#4-the-order-kit-library)
5. [Cost](#5-cost)
6. [Caveats](#6-caveats)
7. [Reproducing the numbers](#7-reproducing-the-numbers)

## 1. Setup common to both experiments

**The model.** Every run used `jev-1.13.0` through TypeSafe's System One API (`POST /v1/systemone`),
on 2026-10-06 and 2026-10-07. A request carries a state and a flat map of questions; each question
is a Choice (one option, up to 255), a Noul (yes/no) or a Score, and Jev returns a probability for
every option of every question. TypeSafe documents that questions in a request are answered
independently ([primitives](https://docs.typesafe.ai/primitives.md)), a 64k-token context per
request, and a price of $0.042 per million input tokens with output free
([models](https://docs.typesafe.ai/models.md), checked 2026-10-06).

**How calls are made.** `research/lab/calls.ts` sends each call, splits a call into several requests when
its estimated size passes 48k tokens, and records every question and answer. A recording client
caches each response under the SHA-256 of `{model, state, questions}`, so any report can be
replayed without calling Jev, and changing any question's text produces a new request.

**Statistics.** For parsing, 95% intervals come from a bootstrap over sentences (4,000 resamples;
words in a sentence aren't independent), and differences between designs are paired: each resample
compares both designs on the same sentences. For pizza orders, differences use an exact two-sided
binomial test on the orders only one design got right (McNemar's test).

**Data use.** Each experiment was developed on dev data. The final numbers come from test data,
run once after the designs were frozen. Section-by-section notes say which data each number comes
from.

**The Jev dial.** Each design is described by how much of the job Jev does, from dial 0 (all code)
to dial 4 (Jev does nearly everything; code only assembles its answers). The code calls this
setting `rung`.

## 2. Experiment 1: dependency parsing

### 2.1 Task, data and scoring

- **Answer key:** [UD English EWT](https://github.com/UniversalDependencies/UD_English-EWT) release
  2.18 (CC BY-SA 4.0), downloaded and SHA-256 checked by `bun run fetch-ud`.
- **Samples:** 25 sentences from each of five length buckets (1–5, 6–10, 11–20, 21–40 and 41+
  words), drawn with a fixed seed. Long sentences are over-represented compared with the treebank,
  which pushes every score down.
- **Scores**, following the CoNLL 2018 shared task conventions (punctuation counted, relation
  subtypes ignored):
  - **attached right (UAS):** the word's head matches the treebank.
  - **+ relationship (LAS):** the head and the relationship name both match.
  - **right pair:** the treebank links the two words in either direction.
  - **word type:** the part of speech (UPOS) matches.

### 2.2 Designs

| Jev dial | Name | Calls | What Jev answers | What code does |
| --- | --- | --- | --- | --- |
| 0 | `rules` | 0 | — | tags words from a small word list; attaches each to the nearest plausible word |
| 1 | `rules-with-jev-types` | 1 | word type (17 options) per word | dial 0's rules, with Jev's word types |
| 2 | `code-proposes-jev-picks` | 3 | word types; head chosen from ~6 code-proposed candidates; relationships | proposes candidates (the rule head, root, neighbors, nearby content words, nouns and verbs); builds a tree |
| 3 | `jev-with-cleanup` | 2 | word types and head from every word, in one call; relationships naming the head | two rules: function words can't be heads (by Jev's types); prepositions, subordinators and conjunctions move onto the word they introduce; builds a tree |
| 4 | `jev-only` | 2 | as dial 3 | builds a tree only |
| q | `jev-phrases` | 4 | (1) word types, neighbor links, direction of the head; (2) head inside each phrase, and which phrase each phrase attaches to; (3) a two-way "second look" at close calls; (4) relationships | cuts phrases from the links; combines votes; builds a tree |
| q | `jev-phrases-plus-attach` | 4 | the same, plus dial 4's attachment question as one more vote | as above |

The **tree builder** finds the highest-scoring tree with exactly one main word (Chu-Liu/Edmonds, as
in [McDonald et al. 2005](https://aclanthology.org/H05-1066/)). Votes from several question sets
multiply (their logs add). Two-level questions follow TypeSafe's tree rule: the path with the best
geometric mean of probabilities
([hierarchical classification](https://docs.typesafe.ai/cookbooks/hierarchical_classification.md)).

### 2.3 How the data was used

| Run | Sentences | Use |
| --- | --- | --- |
| run 2 | 125 dev | first live run; dial 3's two cleanup rules were written after looking at its errors |
| run 3 | the same 125 dev | the full lineup (dial 3 is in-sample here) |
| run 4 | 119 new dev sentences (`--exclude` run 3's ids) | held-out check |
| run 5 | run 3's sentences | the question-design experiments, attachment only (`--unlabeled`) |
| run 6 | run 3's sentences | one call vs two calls |
| **test** | **125 test sentences** | **final numbers, run once** |

The dev split has only 44 sentences of 41+ words, and runs 3 and 4 used all of them.

### 2.4 Final results (test, 125 sentences, 2,524 words)

| Jev dial | Design | Attached right | + relationship | Right pair | Word type | Requests / sentence | Questions / sentence | $ / 1k sentences |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | rules | 41.7% [39.0, 44.6] | 31.6% [29.0, 34.3] | 47.4% | 77.8% | 0 | 0 | 0 |
| 1 | rules-with-jev-types | 55.2% [52.5, 58.2] | 47.0% [44.2, 50.1] | 58.4% | 92.5% | 1.0 | 20 | 0.53 |
| 2 | code-proposes-jev-picks | 52.3% [49.9, 55.0] | 41.3% [38.9, 44.1] | 59.2% | 92.5% | 3.6 | 194 | 2.54 |
| 3 | jev-with-cleanup | **65.7% [62.9, 68.8]** | **52.5% [49.7, 55.6]** | 70.3% | 91.9% | 2.9 | 194 | 3.15 |
| 4 | jev-only | 51.1% [48.9, 53.4] | 40.8% [38.6, 43.3] | 60.2% | 91.9% | 2.9 | 194 | 3.15 |
| q | jev-phrases | 43.5% [41.2, 46.1] | 35.7% [33.4, 38.4] | 50.2% | 92.1% | 4.7 | 244 | 3.14 |
| q | jev-phrases-plus-attach | 48.3% [45.9, 51.0] | 39.5% [37.2, 42.2] | 57.4% | 92.1% | 5.0 | 262 | 4.08 |

Paired differences in attached right (test; held-out dev in brackets after):

| Comparison | Test | Held-out dev |
| --- | --- | --- |
| dial 1 − dial 0 | +13.5 [+10.9, +16.2] | +11.8 [+8.4, +15.3] |
| dial 2 − dial 1 | −3.0 [−5.4, −0.4] | −0.4 [−3.3, +2.6] |
| dial 2 − dial 4 | +1.2 [−0.2, +2.7] | |
| dial 4 − dial 1 | −4.2 [−6.9, −1.4] | −3.7 [−6.7, −0.5] |
| dial 3 − dial 4 | +14.6 [+12.7, +16.5] | +12.0 [+10.2, +14.0] |
| dial 3 − dial 1 | +10.5 [+8.0, +13.1] | +8.3 [+5.6, +11.2] |
| dial 3 − dial 0 | +24.0 [+20.8, +27.4] | |
| jev-phrases − dial 4 | −7.6 [−9.8, −5.3] | −5.2 [−7.8, −2.3] |
| jev-phrases-plus-attach − dial 4 | −2.7 [−4.3, −1.0] | −1.7 [−3.9, +0.7] |

Attached right by sentence length (test, 25 sentences per bucket):

| Design | 1–5 | 6–10 | 11–20 | 21–40 | 41+ |
| --- | --- | --- | --- | --- | --- |
| rules | 57.1% | 44.4% | 40.9% | 39.3% | 41.9% |
| rules-with-jev-types | 61.0% | 63.8% | 56.7% | 56.6% | 52.3% |
| code-proposes-jev-picks | 76.6% | 63.8% | 56.4% | 49.2% | 49.3% |
| jev-with-cleanup | 84.4% | 69.9% | 65.9% | 67.6% | 62.7% |
| jev-only | 79.2% | 53.6% | 51.5% | 49.6% | 49.6% |
| jev-phrases | 81.8% | 58.2% | 50.4% | 38.3% | 39.4% |
| jev-phrases-plus-attach | 79.2% | 57.7% | 53.7% | 45.8% | 44.6% |

The 1–5 bucket holds only about 70 words, so its numbers swing a lot between samples (rules went
from 42% on run 3's sample to 71% on run 4's).

### 2.5 Earlier dev runs

| Design | Run 3 (dev; dial 3 in-sample) | Run 4 (held-out dev, 119 sentences, 2,190 words) |
| --- | --- | --- |
| rules | 43.3% | 41.5% [37.7, 45.2] |
| rules-with-jev-types | 56.5% | 53.2% [50.0, 56.6] |
| code-proposes-jev-picks | 53.8% | 52.8% [50.4, 55.7] |
| jev-with-cleanup | 66.2% | 61.5% [58.6, 64.8] |
| jev-only | 51.3% | 49.5% [46.8, 52.5] |
| jev-phrases | 42.9% | 44.3% [41.8, 47.3] |
| jev-phrases-plus-attach | 47.3% | 47.9% [45.4, 50.7] |
| adjacent (every word on the next word) | | 29.8% |

The cleanup rules' gain over Jev alone was +14.9 points on the sentences they were written from,
+12.0 on held-out dev, and +14.6 on test: they generalize. Decomposed on held-out dev: rule 1
(function words can't be heads) alone +8.8, rule 2 (re-attach introducing words) alone +1.3, both
+12.0. Rule 2's moves were right 74% of the time on held-out dev. It has a known bug: it can move a
preposition onto another function word ("in" onto "the"), which affected 4 words across runs 3
and 4.

### 2.6 What Jev was asked, question by question (test)

"Top answer right" is out of the questions whose right answer was among the options. "≥90% sure"
is the share of those answered with a top probability of at least 0.9.

| Question set | Options | Top answer right | ≥90% sure | Right when ≥90% sure |
| --- | --- | --- | --- | --- |
| word type | 17 | 91.9% | 82.0% | 97.6% |
| which word (all words, dials 3–4) | ~35 on average | 50.1% | 22.8% | 88.7% |
| which word (code's ~6.6 candidates, dial 2) | ~6.6 | 56.7% (right answer offered for 88.1%) | | |
| relationship: kind | 7 | 85.0% | 55.5% | 95.3% |
| relationship: specific (given the right kind) | 2–7 | 89.0% | 72.3% | 98.0% |
| neighbor links (same small phrase?) | yes/no | 71.9% | 29.8% | 90.5% |
| direction of the head | 5 | 42.2% | 18.5% | 87.4% |
| head inside a phrase | ~5.6 | 47.1% | 27.8% | 87.7% |
| which phrase a phrase attaches to | ~12 | 56.7% | 18.8% | 89.1% |
| second look (2 options) | 2 | 70.2% | 8.0% | 100% |

**Distance.** Dial 3 on test attached a word right 86.0% of the time when the treebank's head was a
neighbor (36% of words), 63.0% at 2–4 words (40%), 30.0% at 5 or more (19%), and 72.8% for the main
word (5%).

**Confidence.** Jev's probability for its chosen head (dial 4, test) is well calibrated at the top
and over-confident in the middle (expected calibration error 0.138):

| Jev's probability | Words | Mean probability | Attached right |
| --- | --- | --- | --- |
| 0.0–0.3 | 397 | 0.16 | 23.7% |
| 0.3–0.5 | 439 | 0.41 | 35.8% |
| 0.5–0.7 | 593 | 0.61 | 40.9% |
| 0.7–0.9 | 548 | 0.81 | 54.9% |
| 0.9–1.0 | 547 | 0.97 | 90.3% |

Words where Jev was ≥0.9 sure (22% of words) were attached right 92.2% of the time by dial 3; the
rest 58.3%. Dial 1's rules did worse on those unsure words (48.4%), so falling back to rules there
doesn't help.

### 2.7 Question-design experiments (dev, run 5, attachment only)

Each experiment changes one thing relative to dial 4 (51.3% on these sentences). Paired bootstrap
over the 125 sentences:

| Experiment | Change | Attached right vs dial 4 | Notes |
| --- | --- | --- | --- |
| no-hints | the attachment question without the UD conventions paragraph | **−10.5 [−12.1, −9.0]** | right when ≥90% sure falls from 89.6% to 70.6% |
| no-function-heads | function words banned as heads after Jev answers | **+10.5 [+9.0, +12.2]** | |
| fewer-options | function words removed from the options before asking | **+10.2 [+8.5, +12.0]** | the same as banning afterwards (−0.4 [−1.6, +0.9]), and cheaper |
| neighbors-in-state | each word's neighbors added to the state | **−7.1 [−8.8, −5.2]** | word types also fall, 92.0% → 87.3% |
| nested-types | word type as 3 groups, then the type | −0.7 [−1.5, +0.1] | word types 89.1% vs 92.0% (−2.9 [−3.8, −2.0]); 2.5× the questions |
| no-tree-builder | each word takes Jev's top answer | −1.2 [−2.5, +0.1] | 69.0% vs 85.9% on 1–5 word sentences |
| reversed-order | options in reverse sentence order | −0.9 [−2.1, +0.2] | |
| both-orders | asked in both orders, averaged | −0.3 [−1.2, +0.6] | 65% more cost |
| hints-v2 | conventions reworded | +1.1 [−0.2, +2.2] | |

In the phrase design, removing the direction question changed nothing (−0.2 [−1.8, +1.6]), and
neither did removing the second look (−0.5 [−1.3, +0.2]).

**One call vs two (run 6).** Asking the relationship questions in the first call, before the head
is known ("how does this word relate to the word it attaches to?"), instead of in a second call
that names the head: + relationship −2.4 [−3.3, −1.4]; attached right −0.7 [−1.4, 0.0].

**Bundling.** Word-type questions were asked alone (dial 1) and bundled with the attachment
questions (dial 4's first call), with identical text and state. Over 4,740 questions on runs 3 and
4, the top answer was the same 99.0% of the time and the probabilities identical 67% of the time;
accuracy differed by under 0.3 points. Whether the remaining differences come from the bundle or
from run-to-run variation is untested (it would need the same request sent twice).

### 2.8 Ceilings with perfect answers

An oracle that answers every question from the treebank (dev, 125 sentences) shows what each
design's code allows: dial 1 55.7%, dial 2 87.7% (the candidate lists miss the right head), dial 3
98.5% (the cleanup rules occasionally move a right answer), dial 4 100%, jev-phrases 99.5%.

### 2.9 Context

These comparisons aren't head-to-head: sample, treebank version and setup differ.

- **Zero-shot LLMs:** a 2025 benchmark of open LLMs on EWT (UD 2.14, gold tokenization) found the
  best, Llama 3.1 70B, at 39.69 UAS, against 34.41 for a left-branching baseline
  ([Better Benchmarking LLMs for Zero-Shot Dependency Parsing](https://arxiv.org/html/2502.20866v1)).
- **Trained parsers:** Stanza reports 86.2 UAS on EWT (UD 2.5;
  [Qi et al. 2020](https://arxiv.org/pdf/2003.07082)). LLMs fine-tuned with LoRA reach about 95
  UAS on EWT r2.15 ([Step-by-step Instructions and a Simple Tabular Output Format…](https://arxiv.org/html/2506.09983v2)).
- `research/parsing/baselines/` has a script to run Stanza on exactly these samples; it hasn't been run yet.

## 3. Experiment 2: pizza orders

### 3.1 Task, data and scoring

- **Answer key:** Amazon's [PIZZA benchmark](https://github.com/amazon-science/pizza-semantic-parsing-dataset)
  ([Arkoudas et al. 2022](https://arxiv.org/abs/2212.00265)), pinned to commit `814d6d0`, SHA-256
  checked, CC BY-NC 4.0. Dev has 348 orders and test 1,357, written by people on Mechanical Turk
  (paraphrases of generated orders, and free-form orders); each has the right answer as an EXR
  tree.
- **Menu:** the dataset's catalogs: 85 toppings, 23 styles, 22 drinks, 8 sizes, 2 containers, 11
  volumes, numbers 1–15, two quantities (extra, light), and the surface forms customers use for
  each.
- **Score:** whole order right, the paper's "unordered exact match": the predicted tree equals the
  answer tree when the order of children is ignored at every level
  (`utils/semantic_matchers.py`). This repo sorts children recursively and compares strings, which
  gives the same result. "Items right" is the share of answer-key items (one kind of pizza or drink
  each) reproduced exactly.
- **References from the paper (test):** grammar-based parser (PCFG) 68.02%; BART trained on EXR
  78.56%. The dataset flags each order the PCFG got wrong, which gives the PCFG's score on any
  subset: dev 69.5%, test 68.0%.

### 3.2 Designs

| Jev dial | Name | What Jev answers | What code does |
| --- | --- | --- | --- |
| 0 | `keywords` | — | looks each word up in the catalogs (longest match); ~150 lines of rules group the tags into items (a number starts a new item once the current one has content; "no", "without", "hold" negate the toppings after them until "with" or "add"; "extra" and "light" apply to the next topping) |
| 1 | `keywords-jev-fills-gaps` | for each word the catalogs don't recognize: one Choice over ~171 options (every menu entry, plus "nothing", "the pizza", "not", "extra", "light") | dial 0 otherwise |
| 2 | `code-splits-jev-fills` | for each item code finds: pizza, drink or nothing; how many; size; drink, container, volume; one Choice per style (no / yes / not) and per topping (no / yes / extra / light / not / not extra) | splits the order into items with dial 0's rules |
| 3 | `jev-tags-words` | the 171-option Choice for every word | dial 0's grouping rules |
| 4 | `jev-splits-jev-fills` | yes/no per word "does a new item start here?", then dial 2's questions | cuts the order where Jev said |

Experiments: `jev-tags-words/nested` (11 kinds, then which one); `/bare-names` versions of dials 2
and 3 (menu names only); `/named` versions of dials 2 and 4 (section 3.6); and
`code-splits-jev-fills/named-candidates`, which asks only about styles and toppings sharing a word
with the item.

A second round of experiments asked what an order taker would need (sections 3.8–3.11):

| Experiment | What it adds |
| --- | --- |
| `keywords-jev-fills-gaps/follow-up`, `jev-tags-words/follow-up` | Words whose tag was under 0.9 are asked again in a second call: the same question, narrowed to the first answer's top options (until they hold 99% of the probability, at most 5) plus "nothing", with the words around it quoted. |
| `keywords+check`, `keywords-jev-fills-gaps+check`, `jev-tags-words+check`, `code-splits-jev-fills/named-candidates+check` | One more call: the finished order read back, one line per item, next to what the customer said. Three kinds of yes/no question, phrased so that yes means wrong, as in TypeSafe's [verification cascade](https://docs.typesafe.ai/cookbooks/sde_cascade.md): is the whole order wrong; is each item wrong; is anything missing. The order itself doesn't change. |
| `pick-dial-1-or-3` | Runs dials 1 and 3. When their orders differ, one Choice shows both read back (`a`, `b`, `neither`); which design appears as `a` alternates by a hash of the order's text. |
| `jev-tags-words/examples`, `code-splits-jev-fills/named-candidates/examples` | Every option written as TypeSafe's structured criteria (`what`, `not_for`, `examples`; [advanced primitives](https://docs.typesafe.ai/primitives/advanced.md)). Examples are generic: the menu's own spellings and made-up phrases ("extra olives", "hold the olives"), never words from the orders. |

Every Jev design also reports **gates**: ways an app could decide to accept an order as is rather
than read it back. The first is the **confidence gate**: every answer the order was built from had
a top probability of at least 0.9.

### 3.3 How the data was used

- The keyword rules were written while reading dev orders.
- `keywords` was scored on test once, before any Jev design was finished.
- All Jev designs and experiments were built and compared on dev.
- `named-candidates` was chosen as the best per-item design on dev, then the final test run
  covered `keywords`, dials 1 and 3, and `named-candidates`, once.
- The second-round experiments were designed before either of their runs, run on dev, then on test
  once (all except `jev-tags-words/examples`, left out of the test run for cost). Their first calls
  are the earlier designs' requests, byte for byte, so those answers came from the cache.

### 3.4 Final results (test, 1,357 orders)

| Design | Whole order right | Items right | Questions / order | $ / 1k orders | Orders ≥0.9 sure | Right among them | Right among the rest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PCFG (paper, from the dataset's flags) | 68.0% | | | | | | |
| BART (paper, reported) | 78.6% | | | | | | |
| keywords (dial 0) | 93.3% | 94.6% | 0 | 0 | | | |
| keywords-jev-fills-gaps (dial 1) | **95.1%** | 96.3% | 7 | 1.40 | 47.7% | 99.1% | 91.5% |
| jev-tags-words (dial 3) | **95.1%** | 96.4% | 14 | 2.93 | 14.5% | 100.0% | 94.2% |
| code-splits-jev-fills/named-candidates | 73.2% | 77.3% | 19 | 0.20 | 50.4% | 93.0% | 53.2% |
| **Second round** | | | | | | | |
| pick-dial-1-or-3 | **96.3%** | 97.1% | 21 | 4.33 | 48.3% | 99.1% | 93.7% |
| named-candidates/examples | 84.5% | 86.1% | 19 | 0.30 | 71.4% | 95.0% | 58.2% |
| keywords-jev-fills-gaps/follow-up | 94.3% | 96.1% | 8 | 1.42 | 51.6% | 98.7% | 89.6% |
| jev-tags-words/follow-up | 89.2% | 91.8% | 17 | 2.97 | 21.9% | 100.0% | 86.1% |

The `+check` designs build the same orders as their bases (section 3.8 has what the check adds);
with the check, dial 1 costs $1.43 per 1,000 orders and dial 3 $2.95.

Paired exact tests (orders only one design got right):

| Comparison | Only the first right | Only the second right | p |
| --- | --- | --- | --- |
| dial 1 vs keywords | 39 | 14 | 0.0008 |
| dial 3 vs keywords | 52 | 28 | 0.0097 |
| dial 1 vs dial 3 | 18 | 17 | 1.0 |
| pick vs dial 1 | 16 | 0 | 3 × 10⁻⁵ |
| pick vs dial 3 | 18 | 1 | 8 × 10⁻⁵ |
| named-candidates/examples vs named-candidates | 163 | 10 | < 10⁻³⁰ |
| dial 1 follow-up vs dial 1 | 11 | 22 | 0.08 |
| dial 3 follow-up vs dial 3 | 16 | 96 | < 10⁻¹⁴ |

By number of items in the order (test):

| Design | 1 item (1,099) | 2 items (153) | 3+ items (105) |
| --- | --- | --- | --- |
| keywords | 94.8% | 85.6% | 88.6% |
| keywords-jev-fills-gaps | 96.1% | 91.5% | 90.5% |
| jev-tags-words | 96.4% | 89.5% | 89.5% |
| named-candidates | 77.6% | 66.7% | 37.1% |

Question by question (test):

| Question set | Options | Top answer right | ≥90% sure | Right when ≥90% sure |
| --- | --- | --- | --- | --- |
| word tag (dial 1, unknown words only) | 171 | 99.1% | 91.6% | 99.8% |
| word tag (dial 3, every word) | 171 | 98.9% | 80.0% | 99.7% |
| word tag asked again (dial 1 follow-up) | ~4 | 81.7% | 16.9% | 85.9% |
| word tag asked again (dial 3 follow-up) | ~4 | 92.8% | 26.4% | 98.1% |
| order check: whole order wrong? (dial 1) | yes/no | 90.3% | 68.5% | 98.7% |
| order check: this item wrong? (dial 1) | yes/no | 91.6% | 71.9% | 98.9% |
| order check: anything missing? (dial 1) | yes/no | 94.7% | 48.3% | 99.7% |
| which order did the customer say? (pick) | 3 | 94.7% (38 orders) | 76.3% | 100% |
| item kind | 3 | 99.8% | 99.4% | 99.9% |
| how many | 15 | 99.9% | 99.2% | 100% |
| size | 9 | 99.2% | 98.8% | 99.4% |
| topping (named wording, candidates only) | 6 | 97.7% | 87.1% | 99.4% |
| style (named wording, candidates only) | 3 | 96.6% | 85.6% | 99.7% |
| topping, with examples | 6 | 99.3% | 98.5% | 99.5% |
| style, with examples | 3 | 98.2% | 89.9% | 99.8% |

Word tags are scored only where the answer key labels the word: values, quantities, the pizza
word, "no"-type words just before a negated topping, and words outside every item.

**Ceilings.** With perfect answers (the oracle), the grouping rules allow at most 95.2% on test for
dial 1 and 96.6% for dial 3. Dial 1's 95.1% is at its ceiling: its remaining errors are in the
rules, not in Jev's answers. For example, "make it a large" at the end of an order starts an empty
new item at "a", and "all the meats" counts the meat-lover style twice.

**What Jev added.** In the orders dial 1 fixed, Jev's tags included "more" and "double" as extra,
"coca-colas" as coke, "jalepenos" as jalapeño peppers, "shaved parmasean" as parmesan, "xl" as
extra large, and "pass" in "i'll pass on the peppers" as not.

### 3.5 Dev results (348 orders)

| Design | Whole order right | Items right | Questions / order | $ / 1k orders | Orders ≥0.9 sure | Right among them |
| --- | --- | --- | --- | --- | --- | --- |
| PCFG (paper) | 69.5% | | | | | |
| keywords | 96.0% | 96.3% | 0 | 0 | | |
| keywords-jev-fills-gaps | 97.4% | 97.9% | 7 | 1.44 | 43.7% | 99.3% |
| code-splits-jev-fills | 8.3% | 19.3% | 143 | 1.00 | 1.7% | 100% |
| jev-tags-words | 96.0% | 97.0% | 14 | 2.97 | 9.8% | 100% |
| jev-splits-jev-fills | 6.0% | 21.1% | 209 | 1.45 | 1.1% | 100% |
| jev-tags-words/nested | 89.1% | 91.7% | 128 | 3.50 | 32.8% | 100% |
| jev-tags-words/bare-names | 95.1% | 96.6% | 14 | 2.34 | 10.6% | 100% |
| code-splits-jev-fills/bare-names | 7.2% | 19.3% | 143 | 0.94 | 1.7% | 100% |
| code-splits-jev-fills/named | 69.0% | 72.9% | 143 | 1.14 | 45.4% | 92.4% |
| code-splits-jev-fills/named-candidates | 74.7% | 77.8% | 19 | 0.20 | 54.0% | 92.6% |
| jev-splits-jev-fills/named | 63.5% | 73.6% | 209 | 1.65 | 29.6% | 95.1% |
| **Second round** | | | | | | |
| pick-dial-1-or-3 | 97.7% | 98.2% | 21 | 4.41 | 44.3% | 99.4% |
| jev-tags-words/examples | 97.4% | 98.4% | 14 | 5.60 | 15.5% | 100% |
| named-candidates/examples | 84.5% | 85.8% | 19 | 0.31 | 73.6% | 93.8% |
| keywords-jev-fills-gaps/follow-up | 96.6% | 97.7% | 8 | 1.46 | 48.3% | 99.4% |
| jev-tags-words/follow-up | 91.4% | 93.3% | 18 | 3.02 | 18.1% | 100% |

Paired exact tests (dev): dial 1 vs keywords 8 vs 3 orders (p = 0.23, and the rules were written
on these orders); dial 3 vs keywords 9 vs 9; nested vs flat word tags 6 vs 30 (p < 0.001);
bare vs full names (dial 3) 2 vs 5 (p = 0.45); named-candidates vs named 25 vs 5 (p < 0.001).
Second round: pick vs dial 1 2 vs 1, vs dial 3 6 vs 0 (p = 0.03); dial 3 with examples vs without
6 vs 1 (p = 0.125); named-candidates with examples vs without 35 vs 1 (p < 10⁻⁸); dial 1
follow-up vs dial 1 1 vs 4 (p = 0.38); dial 3 follow-up vs dial 3 4 vs 20 (p = 0.0015).

### 3.6 Why one question per menu item failed

Dial 2 asks ~108 style and topping questions per item. On dev, each question set was 95–99% right,
but whole orders were 8.3% right. Replaying the recorded answers:

- There were 4.2 wrong style or topping answers per order (1,455 in all). Almost all were false
  positives: a topping answered yes (445), not (379), extra (159) or not-extra (90) when the
  customer never mentioned it; a style answered yes (235) or not (137).
- Jev answered by association rather than mention. The most frequent false positives were the
  "combination" style (115), extra mozzarella, cheddar and american cheese (64, 60, 22), green
  peppers (49), italian sausage (45), "not thick crust" (42), roasted green peppers (33), red
  peppers (28) and spiced sausage (25). In the orders checked by hand, the triggers were what you'd
  guess: "sausage and black olives" also got italian sausage (0.93) and the combination style
  (0.85); "pepperoni and extra cheese" also got extra mozzarella (0.95), extra cheddar (0.70) and
  extra american cheese (0.63); "tomatoes and ham" also got tomato sauce (0.92).
- Many were confident: 699 of the 1,455 had probability ≥ 0.8. Counting a style or topping only
  when Jev was at least 0.95 sure lifts dial 2 from 8.3% to 53.7% (0.9: 43.7%; 0.99: 46.3%).
- With ~100 independent questions per item, each must be right about 99.9% of the time for whole
  orders to come out right.

The **named** wording asks whether the customer *names* the entry instead of whether they want it:
"Does the customer name green peppers for `items.i1`? It counts only if they say green peppers.
Don't infer it from anything else they say. If they only say "peppers", that is a different entry,
so the answer here is "not named"." Plainer and more specific entries are listed in both
directions. That took dial 2 from 8.3% to 69.0% on dev, and dial 4 from 6.0% to 63.5%. Asking only
about entries that share a word with the item (19 questions per order instead of 143) added 5.7
points (74.7%). On test, that design reached 73.2%. Its confident orders are less trustworthy than
the word-tag designs' (93.0% right versus 99–100%).

### 3.7 Ceilings with perfect answers (oracle)

| Design | Dev | Test |
| --- | --- | --- |
| keywords-jev-fills-gaps | 97.1% | 95.2% |
| code-splits-jev-fills (and `/named`) | 98.6% | 98.7% |
| jev-tags-words | 98.3% | 96.6% |
| jev-splits-jev-fills | 100% | 100% |
| code-splits-jev-fills/named-candidates | 98.3% | |

### 3.8 Reading the order back (the check)

The `+check` designs ask, after the order is built: is the whole order wrong; is each item wrong;
is anything missing? Each answer is P(wrong). Two gates use them: the **whole-order** question
alone, or the **parts**: every item question and the "anything missing?" question under a cut-off
(the highest of them decides, as in TypeSafe's cascade, which escalates on any single red flag).

**Test** (1,357 orders). "Slip through" counts wrong orders that would be accepted without a
read-back:

| Base design (wrong orders) | Gate | Accepted | Right among accepted | Slip through |
| --- | --- | --- | --- | --- |
| dial 1 (66) | every answer ≥ 0.9 (no check) | 47.7% | 99.1% | 6 |
| | whole order, P(wrong) < 0.5 | 88.3% | 98.4% | 19 |
| | parts < 0.5 | 86.8% | 98.7% | 15 |
| | parts < 0.3 | 75.7% | 99.3% | 7 |
| | parts < 0.2 | 68.1% | 99.7% | 3 |
| | parts < 0.1 | 39.8% | 100% | 0 |
| | every answer ≥ 0.9 and parts < 0.2 | 35.4% | 99.8% | 1 |
| dial 3 (67) | every answer ≥ 0.9 (no check) | 14.5% | 100% | 0 |
| | parts < 0.5 / 0.3 / 0.2 | 86.7% / 75.7% / 68.0% | 98.8% / 99.3% / 99.7% | 14 / 7 / 3 |
| keywords, no Jev in the order (91) | parts < 0.5 / 0.3 / 0.2 | 86.2% / 74.9% / 67.2% | 97.6% / 98.7% / 99.6% | 28 / 13 / 4 |
| named-candidates (363) | every answer ≥ 0.9 (no check) | 50.4% | 93.0% | 48 |
| | whole order < 0.5 | 76.4% | 88.1% | 123 |
| | parts < 0.5 / 0.3 / 0.2 | 69.4% / 59.7% / 51.3% | 95.0% / 97.7% / 99.3% | 47 / 19 / 5 |
| pick + check (50) | parts < 0.5 / 0.3 | 87.7% / 76.8% | 99.1% / 99.4% | 11 / 6 |

**Dev** (348 orders): with dial 1 (9 wrong), parts < 0.5 accepted 88.8% with 2 slipping through;
parts < 0.3 and < 0.2 accepted 73.0% and 66.7% with none; the confidence gate accepted 43.7% with 1.
With named-candidates (88 wrong), parts < 0.5 caught 80 and the whole-order question 65.

What this shows:

- **The cut-off was set at 0.5 before the runs.** The other cut-offs were examined after both runs,
  so they describe the trade-off rather than estimate it on held-out data. The order taker's
  default, 0.3, is also the edge of the uncertain band (0.30–0.70) in TypeSafe's
  [self-consistency cookbook](https://docs.typesafe.ai/cookbooks/consistency_noul_cookbook.md).
- **The parts beat the whole-order question** at the same cut-off, on every base design: one
  question per item plus "anything missing?" catches more wrong orders than one question about the
  whole order.
- **The check works on orders from any design**, including code alone. At a given cut-off it
  accepts about the same share of orders whichever design built them, so a design with more wrong
  orders lets more of them through (at 0.3: 13 for keywords, 7 for dial 1).
- **Per question** (test, dial 1): the check questions were 90–95% right, and 98.7–99.7% right when
  at least 0.9 sure (section 3.4).

### 3.9 Asking again when unsure (follow-up)

Words tagged with probability under 0.9 were asked again with only the options the first answer
was torn between (about 4) plus "nothing", and the words around them quoted. It made orders worse:
dial 3 went from 95.1% to 89.2% on test (16 orders fixed, 96 broken), and dial 1 from 95.1% to
94.3% (11 vs 22, not significant).

Replaying the dev answers for the words asked again (dial 3, 1,219 words): the second answer
turned a right first answer wrong 31 times and a wrong one right 20 times, and changed 85 words the
answer key doesn't label (filler inside items). The most common changes were "nothing" → "no" (43,
e.g. "drinks" in "no drinks" and "i won't need drinks"), the number 1 → "nothing" (17), and
"cheese" → "extra" in "extra cheese" (15). With most options gone and the neighbouring words quoted,
Jev answered for a neighbouring word. The second answers were also rarely sure (17–26% at ≥ 0.9 on
test), so the follow-up didn't help the confidence gate either.

### 3.10 Examples in the options

Rewriting every option as TypeSafe's structured criteria (`what`, `not_for`, `examples`), with
generic examples:

- **Per-topping design** (named-candidates): whole orders 73.2% → 84.5% on test (163 orders fixed,
  10 broken), 74.7% → 84.5% on dev. The topping question went from 97.7% to 99.3% right, and the
  share answered at least 0.9 sure from 87.1% to 98.5%; styles from 96.6% to 98.2%.
- **Word tags, every word** (dial 3, dev only): 96.0% → 97.4% (6 vs 1 orders, p = 0.125, not
  significant); the word tag from 99.1% to 99.4% right, with 84.8% of answers ≥ 0.9 sure instead of
  79.2%, and 15.5% of orders sure throughout instead of 9.8%. The structured options nearly double
  the request ($5.60 per 1,000 orders instead of $2.97), so it wasn't run on test.

### 3.11 Picking between two designs

Dials 1 and 3 built different orders for 10 of 348 dev orders and 38 of 1,357 test orders. For
those, one more Choice showed both orders read back. Jev's pick was right for 8 of 10 on dev and 36
of 38 on test (counting "neither" as right when neither order was). Whole orders went to 97.7% on
dev (2 fixed, 1 broken against dial 1) and 96.3% on test (16 fixed, 0 broken; p = 3 × 10⁻⁵). The
cost is both designs together, $4.33 per 1,000 orders on test. When the two designs agreed (97.2%
of test orders), the shared order was right 96.5% of the time, so agreement alone isn't a useful
gate.

## 4. The order-kit library

[`packages/order-kit`](../packages/order-kit/README.md) packages the designs above for any menu: a menu
names the kinds of item, their fields (one value, a name, or a list with "no", "extra" and
"light"), and the ways customers say each value. `takeOrder` runs dial 1 and the check by default,
with dial 3 (`design: "every-word"`) and the pick (`design: "pick"`) as options, and accepts an
order when every part of the check is under `readBackAt` (default 0.3).

[`examples/order-kit/pizza`](../examples/order-kit/pizza/README.md) describes the PIZZA menu
with it. Checked against the experiment's designs:

- **Questions:** byte-for-byte identical requests for the word, check and pick questions (unit
  tests compare them without calling Jev).
- **Rules:** the library's generic grouping rules build the same items and spans as the pizza
  rules on all 1,705 dev and test orders, from both the menu's tags and the answer key's tags.
- **End to end:** replaying the cached answers through both, order by order
  (`bun run order:pizza:verify`), the requests, orders and check probabilities were identical for
  all 348 dev and 1,357 test orders, for all three designs: 95.1% (default), 95.1% (every-word) and
  96.3% (pick) on test.

Only the pizza menu has been measured. Menus that don't set the wording options get the library's
default phrasing, which hasn't been tested on real orders.

## 5. Cost

At $0.042 per million input tokens (output tokens are free):

- **Parsing (test):** per 1,000 sentences, $0.53 for dial 1, $2.54 for dial 2, $3.15 for dials 3
  and 4, $3.14 for jev-phrases, $4.08 for jev-phrases-plus-attach. Dial 3 asks ~194 questions in
  ~3 requests per sentence.
- **Pizza (test):** per 1,000 orders, $1.40 for dial 1, $2.93 for dial 3, $0.20 for
  named-candidates. A 171-option word-tag question is large (about 5,000 input tokens), so tagging
  only the unknown words is half the cost of tagging every word.
- **Second round (test):** the check adds about $0.03 per 1,000 orders (dial 1 with the check,
  the order taker's default: $1.43); the pick costs both designs ($4.33); examples in the options
  took named-candidates from $0.20 to $0.30, and dial 3 (dev) from $2.97 to $5.60.
- **What the runs cost:** about $12 of Jev credit in all, for every run in this report.

## 6. Caveats

- **One model, one language.** Everything is jev-1.13.0 on English text. Other versions may behave
  differently, especially on wording.
- **Sample sizes.** 125 sentences per parsing sample and 1,357 test orders. Section 2 gives
  intervals and section 3 paired tests; small differences without them shouldn't be read as real.
- **Development on dev data.** The parser's cleanup rules, the pizza rules and the question wording
  were all developed while reading dev results. Test data was run once per design, after the design
  was fixed. The question design experiments (2.7, 3.5, 3.6) are dev-only, and so is dial 3 with
  examples (3.10).
- **Cut-offs chosen after the fact.** The check's 0.5 cut-off was set before its runs; the others
  in 3.8, including the order taker's default of 0.3, were looked at after seeing both dev and test.
- **The answer keys have conventions.** The treebank decides which word of a pair is the head; the
  PIZZA annotators decided that "hamburger" means beef. Some errors are disagreements about
  convention rather than misreadings.
- **Scoring details.** The oracle infers the answer key's "no"-type words from their position just
  before a negated topping, so word-tag scores skip other filler words. Quantities the catalog
  doesn't list ("more") aren't scored as word tags, though they count in whole-order scoring.
- **Determinism untested.** Each request was sent once. Whether Jev returns identical answers to
  identical requests, and so whether the ~1% bundling differences are noise, is untested.
  `bun run order:pizza:verify --client live` measures it on the dev orders.
- **Comparisons with published systems** in 2.9 and 3.1 use different samples or setups, except
  the PIZZA paper's test numbers, which use the same test set and metric.

## 7. Reproducing the numbers

```sh
bun install && bun run fetch-ud && bun run fetch-pizza

# parsing
bun run eval --client record                                   # run 3's sample (dev)
bun run eval --client record --exclude results/runs/<run 3>.ids # a held-out dev sample
bun run eval --client record --all --unlabeled                 # the experiments
bun run eval --client record --strategies jev-only,jev-only/one-call
bun run eval --client record --split test                      # the final numbers
bun run eval --client oracle                                   # ceilings

# pizza
bun run pizza --client record --all                            # dev, every design
bun run pizza --client record --split test --strategies keywords,keywords-jev-fills-gaps,jev-tags-words,code-splits-jev-fills/named-candidates
bun run pizza --client record --split test --strategies keywords,keywords-jev-fills-gaps,jev-tags-words,code-splits-jev-fills/named-candidates,keywords+check,keywords-jev-fills-gaps+check,jev-tags-words+check,code-splits-jev-fills/named-candidates+check,code-splits-jev-fills/named-candidates/examples,keywords-jev-fills-gaps/follow-up,jev-tags-words/follow-up,pick-dial-1-or-3
bun run pizza --client oracle --split test                     # ceilings

# the order taker
bun run order:pizza:verify                                     # vs the experiment, dev (from the cache)
bun run order:pizza:verify --split test
```

Each run writes its full results to `results/` (git-ignored). With the answer cache in place,
`--client replay` reproduces any report without calling Jev.
