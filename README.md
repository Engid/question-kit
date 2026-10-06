# system-one-parsers

A lab for learning how to write questions for a System One model, using sentence parsing as the
test problem. The model is [Jev](https://docs.typesafe.ai) from TypeSafe AI: you send it some
state and a batch of closed questions (pick one option, yes/no, or a score), and it returns a
probability for every answer. There's no LLM and no trained parser here. Every judgment about the
sentence comes from Jev's answers, and code assembles them into a parse.

The lab asks two questions:

1. **How much does Jev add?** It starts from a parser that's all code and lets Jev take over one
   step at a time: the *ladder*.
2. **How should you shape the questions?** Different question sets find different parts of the
   structure. Which shapes suit Jev, and how do you combine them, ideally in one call?

> **Status: work in progress.** So far one strategy (`jev-only`) has been measured live, on 125
> sentences. Everything else is built and tested offline, waiting for its first live run. This
> README only quotes numbers that a recorded run produced.

## How Jev is used

A parse is a few **calls**. Each call sends the sentence as state, plus every question that can be
asked at that point. Jev answers each question independently: one question never sees another's
answer ([TypeSafe docs](https://docs.typesafe.ai/primitives.md)). So everything that doesn't depend
on an earlier answer goes into the same call. A later call can be built from what an earlier one
found, and code runs in between.

This is the state for "The dog chased a red ball across the yard.":

```json
{ "sentence": "The dog chased a red ball across the yard.",
  "words": { "w1": "The", "w2": "dog", "w3": "chased", "w4": "a", "w5": "red",
             "w6": "ball", "w7": "across", "w8": "the", "w9": "yard", "w10": "." } }
```

Questions point into the state with backticked paths. This is one of 20 questions in that call,
trimmed (the full instruction also spells out UD's attachment conventions):

```json
"head_w9": {
  "type": "choice",
  "instructions": "In `sentence`, which word is the head of `words.w9`, the word that `words.w9` attaches to as a modifier, argument or function word? …",
  "criteria": {
    "w1": "`words.w1` (\"The\", the first word)",
    "w7": "`words.w7` (\"across\", after \"ball\")",
    "…": "one option per other word",
    "root": "None: `words.w9` is the main word (predicate) of the whole sentence."
  }
}
```

Jev's answer, from a recorded run (jev-1.13.0, 2026-10-06):

```json
"head_w9": { "choice": "w7", "confidence": 0.87,
             "probabilities": { "w7": 0.89, "w3": 0.05, "w8": 0.04, "w10": 0.01, "root": 0.01, "…": "…" } }
```

To watch this for any sentence, with every question and answer and what code did in between:

```sh
bun run explain "The dog chased a red ball across the yard."
```

## Question sets

Each set is one kind of question, asked about many words, in its own file in
[`src/question-sets/`](src/question-sets/):

| Question set | The question | Shape |
| --- | --- | --- |
| `word-type` | What kind of word is this? | Choice over 17 word types, or nested: 3 groups, then the type |
| `attach-to` | Which word does this word attach to? | Choice over every other word + root, or over code's candidates |
| `relationship` | How does this word relate to the word it attaches to? | Nested: 7 kinds, then 2–7 relationships within the kind |
| `neighbor-links` | Are these two neighboring words in the same small phrase? | Yes/no per pair of neighbors |
| `direction` | Where is the word this word attaches to? | Choice: just before, further back, just after, further ahead, or main word |
| `inside-phrase` | Inside this phrase, which word does this word attach to? | Choice over the phrase's other words + "outside" |
| `between-phrases` | Which phrase does this phrase attach to? | Choice over the other phrases + root |
| `second-look` | Which of these two does this word attach to? | Choice of 2, asked in both orders |

Answers about attachments become **votes**: a probability for each possible head of each word.
Votes from different sets are multiplied, and the **tree builder** picks the best-scoring set of
attachments that forms a valid tree with one main word (Chu-Liu/Edmonds, as in McDonald et al.
2005, [H05-1066](https://aclanthology.org/H05-1066/)). Nested questions are combined with
TypeSafe's tree rule: the geometric mean of the probabilities along the path
([hierarchical classification](https://docs.typesafe.ai/cookbooks/hierarchical_classification.md)).

## Strategies

A strategy is a recipe of calls and code steps. Each one is a short function you can read top to
bottom: [`ladder.ts`](src/strategies/ladder.ts) and [`phrases.ts`](src/strategies/phrases.ts).

**The ladder**

| Rung | Strategy | Jev's part | Code's part |
| --- | --- | --- | --- |
| 0 | `rules` | none | tags words from a small word list; attaches by "nearest plausible word" rules |
| 1 | `rules-with-jev-types` | word types (1 call) | the same rules, using Jev's word types |
| 2 | `code-proposes-jev-picks` | word types, then picks each word's head from code's ~6 candidates, then relationships | proposes the candidates: TypeSafe's ["code finds candidates, the model picks"](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook.md) pattern |
| 3 | `jev-with-cleanup` | word types and heads from every word in one call, then relationships | builds the tree; two rules for UD conventions |
| 4 | `jev-only` | the same calls as rung 3 | builds the tree only |

**Question design**

| Strategy | Calls |
| --- | --- |
| `jev-phrases` | (1) word types + neighbor links + direction; code cuts phrases. (2) inside phrases + between phrases. (3) second look at close calls. (4) relationships. |
| `jev-phrases-plus-attach` | The same, plus the big attach-to question in call 1 as one more vote. |

`bun run eval --list` shows these and the experiments: one knob changed at a time, such as option
order, nested word types, everything in one call, no tree builder, or neighbors in the state.

## Try it

```sh
bun install
bun run fetch-ud        # UD English EWT r2.18 (CC BY-SA 4.0), downloaded and SHA-256 checked, not redistributed
bun test                # offline
bun run explain "Your sentence here."          # needs TYPESAFE_API_KEY in .env; answers are cached
bun run eval --client record                   # the report card on 125 dev sentences
```

[`docs/evals.md`](docs/evals.md) explains every option and every column of the output.

## Results so far

From one live run (2026-10-06, jev-1.13.0) on 125 EWT dev sentences (2,550 words, 25 per length
bucket), replayed from the cache with `bun run eval --strategies rules,jev-only`:

| Strategy | Attached right | Right pair | + relationship | Word type | $ / 1k sentences |
| --- | --- | --- | --- | --- | --- |
| `rules` (rung 0) | 43.3% | 48.0% | 32.8% | 78.5% | 0 |
| `jev-only` (rung 4) | 51.3% | 60.7% | 40.0% | 92.0% | 3.18 |

What Jev was asked in `jev-only`, and how often its top answer matched the treebank:

| Question set | Options | Top answer right | ≥90% sure | Right when ≥90% sure |
| --- | --- | --- | --- | --- |
| word type | 17 | 92.0% | 81.4% | 97.9% |
| attach-to | 34.8 on average | 50.0% | 24.6% | 89.6% |
| relationship: kind | 7 | 82.2% | 54.6% | 97.0% |
| relationship: specific | 5.6 on average | 90.2% | 71.5% | 98.6% |

Relationships are scored only where the attachment was right.

What this sample shows (an analysis of the same answers):

- Jev's word types and relationship names are mostly right. When it's ≥90% sure of any answer, it's
  right 90–99% of the time, depending on the question set.
- Attachment is the weak point. Jev is right 87% of the time when the answer is a neighboring word,
  but under 10% when it's 5 or more words away, so accuracy falls with sentence length: 86% for
  sentences of 1–5 words, 47–52% from 11 words up.
- Jev attaches words the school-grammar way more than UD's way. "yard" goes on "across" rather than
  the reverse, which is why "right pair" is 9 points above "attached right". Rung 3's cleanup rules
  and the phrase strategies target exactly this. Their numbers come with the next live run.

For scale, the Stanza paper reports a trained parser at 86.2% attached right on EWT
([Qi et al. 2020](https://arxiv.org/pdf/2003.07082), UD 2.5, probably from raw text, so not
directly comparable). [`baselines/`](baselines/README.md) runs Stanza on exactly our setup.

## Layout

```
src/sentence.ts        the state Jev sees, and how questions refer to words
src/calls.ts           sends calls, splits big ones, records every question and answer
src/question-sets/     one file per question set: the questions, how to read the answers, how to score them
src/votes.ts           combining attachment votes; the tree builder
src/code-rules/        the rules parser, the candidate proposer, the cleanup rules
src/strategies/        the ladder, the phrase strategies, the experiments
src/gold.ts            the treebank's answers (and our phrase definition) for scoring
src/oracle.ts          a fake Jev that answers from the treebank, for testing the code around Jev
eval/                  explain, eval, scoring, rendering
docs/evals.md          how to run and read the evals; glossary
baselines/             a Python script that runs a trained parser on the same sentences
```

## License

MIT for the code. UD English EWT is CC BY-SA 4.0 and is downloaded at eval time, not
redistributed. The idea of parsing with closed questions generalizes Stately's
[jevspresso](https://github.com/statelyai/jevspresso) demo. No code is copied from it.
