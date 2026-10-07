# Detailed report

This is the full record behind the [README](../README.md): how each experiment was run, every
result with its uncertainty, and what the numbers do and don't show. Terms are defined in the
[eval guide's glossary](evals.md#glossary).

**Contents**

1. [Setup common to both experiments](#1-setup-common-to-both-experiments)
2. [Experiment 1: dependency parsing](#2-experiment-1-dependency-parsing)
3. [Experiment 2: pizza orders](#3-experiment-2-pizza-orders)
4. [Cost](#4-cost)
5. [Caveats](#5-caveats)
6. [Reproducing the numbers](#6-reproducing-the-numbers)

## 1. Setup common to both experiments

**The model.** Every run used `jev-1.13.0` through TypeSafe's System One API (`POST /v1/systemone`),
on 2026-10-06 and 2026-10-07. A request carries a state and a flat map of questions; each question
is a Choice (one option, up to 255), a Noul (yes/no) or a Score, and Jev returns a probability for
every option of every question. TypeSafe documents that questions in a request are answered
independently ([primitives](https://docs.typesafe.ai/primitives.md)), a 64k-token context per
request, and a price of $0.042 per million input tokens with output free
([models](https://docs.typesafe.ai/models.md), checked 2026-10-06).

**How calls are made.** `src/calls.ts` sends each call, splits a call into several requests when
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

| Rung | Name | Calls | What Jev answers | What code does |
| --- | --- | --- | --- | --- |
| 0 | `rules` | 0 | — | tags words from a small word list; attaches each to the nearest plausible word |
| 1 | `rules-with-jev-types` | 1 | word type (17 options) per word | rung 0's rules, with Jev's word types |
| 2 | `code-proposes-jev-picks` | 3 | word types; head chosen from ~6 code-proposed candidates; relationships | proposes candidates (the rule head, root, neighbors, nearby content words, nouns and verbs); builds a tree |
| 3 | `jev-with-cleanup` | 2 | word types and head from every word, in one call; relationships naming the head | two rules: function words can't be heads (by Jev's types); prepositions, subordinators and conjunctions move onto the word they introduce; builds a tree |
| 4 | `jev-only` | 2 | as rung 3 | builds a tree only |
| q | `jev-phrases` | 4 | (1) word types, neighbor links, direction of the head; (2) head inside each phrase, and which phrase each phrase attaches to; (3) a two-way "second look" at close calls; (4) relationships | cuts phrases from the links; combines votes; builds a tree |
| q | `jev-phrases-plus-attach` | 4 | the same, plus rung 4's attachment question as one more vote | as above |

The **tree builder** finds the highest-scoring tree with exactly one main word (Chu-Liu/Edmonds, as
in [McDonald et al. 2005](https://aclanthology.org/H05-1066/)). Votes from several question sets
multiply (their logs add). Two-level questions follow TypeSafe's tree rule: the path with the best
geometric mean of probabilities
([hierarchical classification](https://docs.typesafe.ai/cookbooks/hierarchical_classification.md)).

### 2.3 How the data was used

| Run | Sentences | Use |
| --- | --- | --- |
| run 2 | 125 dev | first live run; rung 3's two cleanup rules were written after looking at its errors |
| run 3 | the same 125 dev | the full lineup (rung 3 is in-sample here) |
| run 4 | 119 new dev sentences (`--exclude` run 3's ids) | held-out check |
| run 5 | run 3's sentences | the question-design experiments, attachment only (`--unlabeled`) |
| run 6 | run 3's sentences | one call vs two calls |
| **test** | **125 test sentences** | **final numbers, run once** |

The dev split has only 44 sentences of 41+ words, and runs 3 and 4 used all of them.

### 2.4 Final results (test, 125 sentences, 2,524 words)

| Rung | Design | Attached right | + relationship | Right pair | Word type | Requests / sentence | Questions / sentence | $ / 1k sentences |
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
| rung 1 − rung 0 | +13.5 [+10.9, +16.2] | +11.8 [+8.4, +15.3] |
| rung 2 − rung 1 | −3.0 [−5.4, −0.4] | −0.4 [−3.3, +2.6] |
| rung 2 − rung 4 | +1.2 [−0.2, +2.7] | |
| rung 4 − rung 1 | −4.2 [−6.9, −1.4] | −3.7 [−6.7, −0.5] |
| rung 3 − rung 4 | +14.6 [+12.7, +16.5] | +12.0 [+10.2, +14.0] |
| rung 3 − rung 1 | +10.5 [+8.0, +13.1] | +8.3 [+5.6, +11.2] |
| rung 3 − rung 0 | +24.0 [+20.8, +27.4] | |
| jev-phrases − rung 4 | −7.6 [−9.8, −5.3] | −5.2 [−7.8, −2.3] |
| jev-phrases-plus-attach − rung 4 | −2.7 [−4.3, −1.0] | −1.7 [−3.9, +0.7] |

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

| Design | Run 3 (dev; rung 3 in-sample) | Run 4 (held-out dev, 119 sentences, 2,190 words) |
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
| which word (all words, rungs 3–4) | ~35 on average | 50.1% | 22.8% | 88.7% |
| which word (code's ~6.6 candidates, rung 2) | ~6.6 | 56.7% (right answer offered for 88.1%) | | |
| relationship: kind | 7 | 85.0% | 55.5% | 95.3% |
| relationship: specific (given the right kind) | 2–7 | 89.0% | 72.3% | 98.0% |
| neighbor links (same small phrase?) | yes/no | 71.9% | 29.8% | 90.5% |
| direction of the head | 5 | 42.2% | 18.5% | 87.4% |
| head inside a phrase | ~5.6 | 47.1% | 27.8% | 87.7% |
| which phrase a phrase attaches to | ~12 | 56.7% | 18.8% | 89.1% |
| second look (2 options) | 2 | 70.2% | 8.0% | 100% |

**Distance.** Rung 3 on test attached a word right 86.0% of the time when the treebank's head was a
neighbor (36% of words), 63.0% at 2–4 words (40%), 30.0% at 5 or more (19%), and 72.8% for the main
word (5%).

**Confidence.** Jev's probability for its chosen head (rung 4, test) is well calibrated at the top
and over-confident in the middle (expected calibration error 0.138):

| Jev's probability | Words | Mean probability | Attached right |
| --- | --- | --- | --- |
| 0.0–0.3 | 397 | 0.16 | 23.7% |
| 0.3–0.5 | 439 | 0.41 | 35.8% |
| 0.5–0.7 | 593 | 0.61 | 40.9% |
| 0.7–0.9 | 548 | 0.81 | 54.9% |
| 0.9–1.0 | 547 | 0.97 | 90.3% |

Words where Jev was ≥0.9 sure (22% of words) were attached right 92.2% of the time by rung 3; the
rest 58.3%. Rung 1's rules did worse on those unsure words (48.4%), so falling back to rules there
doesn't help.

### 2.7 Question-design experiments (dev, run 5, attachment only)

Each experiment changes one thing relative to rung 4 (51.3% on these sentences). Paired bootstrap
over the 125 sentences:

| Experiment | Change | Attached right vs rung 4 | Notes |
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

**Bundling.** Word-type questions were asked alone (rung 1) and bundled with the attachment
questions (rung 4's first call), with identical text and state. Over 4,740 questions on runs 3 and
4, the top answer was the same 99.0% of the time and the probabilities identical 67% of the time;
accuracy differed by under 0.3 points. Whether the remaining differences come from the bundle or
from run-to-run variation is untested (it would need the same request sent twice).

### 2.8 Ceilings with perfect answers

An oracle that answers every question from the treebank (dev, 125 sentences) shows what each
design's code allows: rung 1 55.7%, rung 2 87.7% (the candidate lists miss the right head), rung 3
98.5% (the cleanup rules occasionally move a right answer), rung 4 100%, jev-phrases 99.5%.

### 2.9 Context

These comparisons aren't head-to-head: sample, treebank version and setup differ.

- **Zero-shot LLMs:** a 2025 benchmark of open LLMs on EWT (UD 2.14, gold tokenization) found the
  best, Llama 3.1 70B, at 39.69 UAS, against 34.41 for a left-branching baseline
  ([Better Benchmarking LLMs for Zero-Shot Dependency Parsing](https://arxiv.org/html/2502.20866v1)).
- **Trained parsers:** Stanza reports 86.2 UAS on EWT (UD 2.5;
  [Qi et al. 2020](https://arxiv.org/pdf/2003.07082)). LLMs fine-tuned with LoRA reach about 95
  UAS on EWT r2.15 ([Step-by-step Instructions and a Simple Tabular Output Format…](https://arxiv.org/html/2506.09983v2)).
- `baselines/` has a script to run Stanza on exactly these samples; it hasn't been run yet.

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

| Rung | Name | What Jev answers | What code does |
| --- | --- | --- | --- |
| 0 | `keywords` | — | looks each word up in the catalogs (longest match); ~150 lines of rules group the tags into items (a number starts a new item once the current one has content; "no", "without", "hold" negate the toppings after them until "with" or "add"; "extra" and "light" apply to the next topping) |
| 1 | `keywords-jev-fills-gaps` | for each word the catalogs don't recognize: one Choice over ~171 options (every menu entry, plus "nothing", "the pizza", "not", "extra", "light") | rung 0 otherwise |
| 2 | `code-splits-jev-fills` | for each item code finds: pizza, drink or nothing; how many; size; drink, container, volume; one Choice per style (no / yes / not) and per topping (no / yes / extra / light / not / not extra) | splits the order into items with rung 0's rules |
| 3 | `jev-tags-words` | the 171-option Choice for every word | rung 0's grouping rules |
| 4 | `jev-splits-jev-fills` | yes/no per word "does a new item start here?", then rung 2's questions | cuts the order where Jev said |

Experiments: `jev-tags-words/nested` (11 kinds, then which one); `/bare-names` versions of rungs 2
and 3 (menu names only); `/named` versions of rungs 2 and 4 (section 3.6); and
`code-splits-jev-fills/named-candidates`, which asks only about styles and toppings sharing a word
with the item.

Every Jev design also reports a **confidence gate**: the share of orders where every answer the
order was built from had a top probability of at least 0.9, and how often those were right.

### 3.3 How the data was used

- The keyword rules were written while reading dev orders.
- `keywords` was scored on test once, before any Jev design was finished.
- All Jev designs and experiments were built and compared on dev.
- `named-candidates` was chosen as the best per-item design on dev, then the final test run
  covered `keywords`, rungs 1 and 3, and `named-candidates`, once.

### 3.4 Final results (test, 1,357 orders)

| Design | Whole order right | Items right | Questions / order | $ / 1k orders | Orders ≥0.9 sure | Right among them | Right among the rest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PCFG (paper, from the dataset's flags) | 68.0% | | | | | | |
| BART (paper, reported) | 78.6% | | | | | | |
| keywords (rung 0) | 93.3% | 94.6% | 0 | 0 | | | |
| keywords-jev-fills-gaps (rung 1) | **95.1%** | 96.3% | 7 | 1.40 | 47.7% | 99.1% | 91.5% |
| jev-tags-words (rung 3) | **95.1%** | 96.4% | 14 | 2.93 | 14.5% | 100.0% | 94.2% |
| code-splits-jev-fills/named-candidates | 73.2% | 77.3% | 19 | 0.20 | 50.4% | 93.0% | 53.2% |

Paired exact tests (orders only one design got right):

| Comparison | Only the first right | Only the second right | p |
| --- | --- | --- | --- |
| rung 1 vs keywords | 39 | 14 | 0.0008 |
| rung 3 vs keywords | 52 | 28 | 0.0097 |
| rung 1 vs rung 3 | 18 | 17 | 1.0 |

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
| word tag (rung 1, unknown words only) | 171 | 99.1% | 91.6% | 99.8% |
| word tag (rung 3, every word) | 171 | 98.9% | 80.0% | 99.7% |
| item kind | 3 | 99.8% | 99.4% | 99.9% |
| how many | 15 | 99.9% | 99.2% | 100% |
| size | 9 | 99.2% | 98.8% | 99.4% |
| topping (named wording, candidates only) | 6 | 97.7% | 87.1% | 99.4% |
| style (named wording, candidates only) | 3 | 96.6% | 85.6% | 99.7% |

Word tags are scored only where the answer key labels the word: values, quantities, the pizza
word, "no"-type words just before a negated topping, and words outside every item.

**Ceilings.** With perfect answers (the oracle), the grouping rules allow at most 95.2% on test for
rung 1 and 96.6% for rung 3. Rung 1's 95.1% is at its ceiling: its remaining errors are in the
rules, not in Jev's answers. For example, "make it a large" at the end of an order starts an empty
new item at "a", and "all the meats" counts the meat-lover style twice.

**What Jev added.** In the orders rung 1 fixed, Jev's tags included "more" and "double" as extra,
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

Paired exact tests (dev): rung 1 vs keywords 8 vs 3 orders (p = 0.23, and the rules were written
on these orders); rung 3 vs keywords 9 vs 9; nested vs flat word tags 6 vs 30 (p < 0.001);
bare vs full names (rung 3) 2 vs 5 (p = 0.45); named-candidates vs named 25 vs 5 (p < 0.001).

### 3.6 Why one question per menu item failed

Rung 2 asks ~108 style and topping questions per item. On dev, each question set was 95–99% right,
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
  when Jev was at least 0.95 sure lifts rung 2 from 8.3% to 53.7% (0.9: 43.7%; 0.99: 46.3%).
- With ~100 independent questions per item, each must be right about 99.9% of the time for whole
  orders to come out right.

The **named** wording asks whether the customer *names* the entry instead of whether they want it:
"Does the customer name green peppers for `items.i1`? It counts only if they say green peppers.
Don't infer it from anything else they say. If they only say "peppers", that is a different entry,
so the answer here is "not named"." Plainer and more specific entries are listed in both
directions. That took rung 2 from 8.3% to 69.0% on dev, and rung 4 from 6.0% to 63.5%. Asking only
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

## 4. Cost

At $0.042 per million input tokens (output tokens are free):

- **Parsing (test):** per 1,000 sentences, $0.53 for rung 1, $2.54 for rung 2, $3.15 for rungs 3
  and 4, $3.14 for jev-phrases, $4.08 for jev-phrases-plus-attach. Rung 3 asks ~194 questions in
  ~3 requests per sentence.
- **Pizza (test):** per 1,000 orders, $1.40 for rung 1, $2.93 for rung 3, $0.20 for
  named-candidates. A 171-option word-tag question is large (about 5,000 input tokens), so tagging
  only the unknown words is half the cost of tagging every word.

## 5. Caveats

- **One model, one language.** Everything is jev-1.13.0 on English text. Other versions may behave
  differently, especially on wording.
- **Sample sizes.** 125 sentences per parsing sample and 1,357 test orders. Section 2 gives
  intervals and section 3 paired tests; small differences without them shouldn't be read as real.
- **Development on dev data.** The parser's cleanup rules, the pizza rules and the question wording
  were all developed while reading dev results. Test data was run once, at the end. The question
  design experiments (2.7, 3.5, 3.6) are dev-only.
- **The answer keys have conventions.** The treebank decides which word of a pair is the head; the
  PIZZA annotators decided that "hamburger" means beef. Some errors are disagreements about
  convention rather than misreadings.
- **Scoring details.** The oracle infers the answer key's "no"-type words from their position just
  before a negated topping, so word-tag scores skip other filler words. Quantities the catalog
  doesn't list ("more") aren't scored as word tags, though they count in whole-order scoring.
- **Determinism untested.** Each request was sent once. Whether Jev returns identical answers to
  identical requests, and so whether the ~1% bundling differences are noise, is untested.
- **Comparisons with published systems** in 2.9 and 3.1 use different samples or setups, except
  the PIZZA paper's test numbers, which use the same test set and metric.

## 6. Reproducing the numbers

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
bun run pizza --client oracle --split test                     # ceilings
```

Each run writes its full results to `results/` (git-ignored). With the answer cache in place,
`--client replay` reproduces any report without calling Jev.
