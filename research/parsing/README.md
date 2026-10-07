# Running and reading the evals

There are two commands:

- **`bun run explain`** shows one sentence going through one strategy. You see every Jev call, an
  example question and answer exactly as sent and received, every answer in plain words, what code
  did between calls, and the final tree.
- **`bun run eval`** scores strategies on a sample of the treebank and prints a report card.

Both read Jev's answers from a local cache by default, so re-running costs nothing. Words in
*italics* below are defined in the [glossary](#glossary).

## First steps

```sh
bun install
bun run fetch-ud                    # the treebank (UD English EWT r2.18), about 4 MB, SHA-256 checked
bun test                            # offline unit tests; never calls the API

bun run explain "The dog chased a red ball across the yard."    # calls Jev (cached afterwards)
bun run eval --list                 # every strategy, with one line each
bun run eval                        # the report card, from the cache
bun run eval --client record        # the same, calling Jev for anything not cached yet
```

The live API needs `TYPESAFE_API_KEY` in `.env`.

## `bun run explain`

```sh
bun run explain "Any sentence you like."
bun run explain --id reviews-137883-0002                  # a treebank sentence: answers get ✓ / ✗
bun run explain --id reviews-137883-0002 --strategy jev-phrases
bun run explain "…" --client replay                       # cached answers only; fails on a miss
bun run explain "…" --raw                                 # every question and answer as raw JSON
```

| Option | Default | What it does |
| --- | --- | --- |
| `--strategy NAME` | `jev-only` | Any name from `bun run eval --list`. |
| `--id SENT_ID` | — | Use a treebank sentence instead of your own text, and mark each answer ✓ or ✗ against the treebank. Sentence ids are in `results/runs/*.ids` and in eval output. |
| `--split dev\|test` | `dev` | Where `--id` looks. |
| `--client` | `record` | `record`: use the cache and call Jev on a miss. `replay`: cache only. `live`: always call Jev. `dry`: fake uniform answers (sizes only). `oracle`: answers from the treebank (needs `--id`; a plumbing check). |
| `--raw` | off | Print every question and answer in full JSON instead of one example per question set. |
| `--mermaid` | off | Print only the resulting tree, as a Mermaid diagram to paste into Markdown (wrong attachments in red with `--id`). |

How to read it:

- **Words:** the ids (`w1`, `w2`, …) that questions use to point at words, as in `` `words.w3` ``.
- **Call N of M:** one Jev request, or several if it was split for size. The header shows the number
  of questions, input tokens, time and model. The state is printed whenever it changes; every
  question in that request reads it.
- **▸ question set:** for each set in the call:
  - **Example question, exactly as sent:** the instructions and the first options, then the same
    question with the paths replaced by the words ("In plain words").
  - **Its answer, exactly as returned:** the JSON Jev sent back.
  - **All answers:** a table with one row per question: what it's about, Jev's top answer, its
    probability (`p`) and a bar, the runners-up, and with `--id` a `treebank` column: ✓, or ✗ and
    the treebank's answer.
  - **Two-level questions** (word type in groups, relationships) show the first level, then
    `›`, then the second-level answer, following the best path.
- **Code:** what code did between calls, e.g. which phrases it formed, or how many attachments the
  *tree builder* changed.
- **Result:** the tree, starting from the *main word*. A line notes when code, not Jev's top answer,
  decided an attachment. With `--id`, `✗` marks a wrong attachment and names the word the treebank
  attaches it to, and `~` marks a wrong relationship name.

## `bun run eval`

```sh
bun run eval                                        # the lineup, 25 sentences per length bucket, from the cache
bun run eval --client record                        # call Jev for whatever isn't cached
bun run eval --all                                  # the lineup plus every experiment
bun run eval --strategies jev-only,jev-phrases      # just these
bun run eval --detail                               # extra tables per Jev strategy
bun run eval --unlabeled                            # skip the relationship questions (cheaper; attachments only)
```

### Options

| Option | Default | What it does |
| --- | --- | --- |
| `--strategies a,b` | the lineup | Comma-separated strategy names (see `--list`). |
| `--all` | off | The lineup plus every experiment. |
| `--list` | — | Print every strategy with a one-line summary, then exit. |
| `--client` | `replay` | Where Jev's answers come from. `replay`: cache only, never calls the API (strategies with missing answers are left out and listed). `record`: cache, calling Jev on a miss and saving the answer. `live`: always call Jev, no cache. `oracle`: answers from the treebank, a plumbing check that should give ~100%. `dry`: fake uniform answers, useful for request counts, sizes and estimated cost. |
| `--per-bucket N` | `25` | Sentences per length bucket (1–5, 6–10, 11–20, 21–40 and 41+ words). Dev has only 44 sentences of 41+ words. |
| `--max-len N` | — | Skip sentences longer than N words. |
| `--limit N` | — | Cap the total number of sentences. |
| `--split dev\|test` | `dev` | Treebank split. Use `test` sparingly, for a final check. |
| `--ids FILE` | — | Run exactly these sentence ids (one per line), e.g. an earlier run's `.ids` file. |
| `--exclude FILE` | — | Leave these sentence ids out: a held-out sample that doesn't overlap an earlier run. |
| `--seed N` | `20261006` | Sampling seed. The same seed gives the same sample on every machine. |
| `--unlabeled` | off | Skip the relationship questions. Attachment scores only, at well under half the tokens (≈42% for jev-only, by `--client dry`). |
| `--detail` | off | Per Jev strategy: confidence vs accuracy, flagging close calls, accuracy by distance and by relationship, and the two worst sentences. |
| `--examples N` | `1` | Example sentences drawn as trees, for the best Jev strategy. |
| `--concurrency N` | `4` | Sentences sent to Jev at once. TypeSafe lists rate limits of 80 requests/s. |
| `--label NAME` | — | Name added to the saved files. |
| `--no-save` | off | Don't write `results/`. |
| `--cache-dir DIR` | `.cache/jev` | Where Jev's answers are cached. |

### Reading the report card

**Strategies: how often each word is attached to the right word.**

| Column | Meaning |
| --- | --- |
| dial | The Jev dial: 0 = all code … 4 = all Jev. `q` = a question-design strategy, `·` = an experiment. |
| attached right | Share of words whose *head* matches the treebank (UAS). |
| right pair | Share of the treebank's links the parse also has, in either direction. The gap from "attached right" is mostly convention: which word of a pair counts as the head. |
| + relationship | Attached right, and the relationship name matches (LAS). |
| word type | Share of words with the right word type (UPOS). |
| calls | Jev requests per sentence (a big call can be split into several requests). |
| questions | Questions per sentence. |
| $ / 1k sentences | Cost per 1,000 sentences at TypeSafe's listed price. `≈` means estimated from request size because Jev didn't report usage (dry or oracle runs). |

**Attached right, by sentence length.** Long sentences have more long-distance attachments, which
are harder for every parser.

**What Jev was asked.** For each Jev strategy, one row per *question set* (two-level sets get a row
per level):

| Column | Meaning |
| --- | --- |
| options | Average number of options per question. |
| asked | Number of questions scored. |
| right answer offered | Share of questions where the treebank's answer was among the options. It's below 100% when code's candidate list missed the right head, or when a relationship is asked about a word the parse attached wrongly. |
| top answer right | Of the questions with a right answer offered, how often Jev's top answer was it. |
| ≥90% sure | Share of those where Jev's top answer had probability ≥ 0.9. |
| right when ≥90% sure | How often Jev was right when it was that sure. When this is high, a confident answer can be trusted without checking. |

**Examples.** Sentences of 6–12 words whose score is close to the strategy's overall score, drawn
as trees, with the `explain` command that shows every question behind them.

**With `--detail`:**

- **Is Jev's confidence meaningful?** Words binned by Jev's probability for the chosen head, with how
  many of each bin were right. If the two columns track each other, the probabilities are
  *calibrated*.
- **Flagging close calls.** If code flagged every attachment whose top two candidates are within a
  factor *t* (separation < *t*): how many get flagged, how many of the flags are real errors, how
  many errors get caught, and how good the unflagged ones are.
- **By distance:** accuracy by how far away the right head is.
- **By treebank relationship:** which constructions are hard.
- **Worst sentences:** word by word.

### Saved files

Each run (unless `--no-save`) writes to `results/runs/`:

- `<time>[-label].json`: everything in the report card, plus each sentence's parse in CoNLL-U.
- `<time>[-label].ids`: the sentence ids, for `--ids` / `--exclude` and for the Stanza baseline.
- `<time>[-label].<strategy>.conllu`: each strategy's parses in CoNLL-U, which standard UD tools
  read.

`results/` and `.cache/` are git-ignored: runs stay on your machine.

## Recipes

**See what a question set does on real sentences.**
`bun run eval --strategies jev-phrases --client record`, then `bun run explain --id <an id from the
examples> --strategy jev-phrases --client replay`.

**Check a change on sentences you haven't looked at.**
`bun run eval --client record --exclude results/runs/<earlier run>.ids`. This gives a sample with
no overlap.

**Compare attachments only, cheaply.**
`--unlabeled` skips the 8 relationship questions per word, which are more than half of all tokens.

**Estimate cost before spending.**
`bun run eval --client dry --all` prints questions and estimated $ per 1,000 sentences without
calling Jev.

**Check the plumbing after changing code.**
`bun run eval --client oracle --all`. Strategies that are pure Jev should score ~100%. Ones with
code rules or a candidate list show the ceiling those rules impose.

**Compare with a trained parser.** See [`baselines/README.md`](baselines/README.md).

## Glossary

| Term | Meaning |
| --- | --- |
| head / attach to | In a dependency tree every word attaches to one other word, its head: "red" attaches to "ball", "ball" to "chased". |
| main word / root | The one word that attaches to nothing (usually the main verb). Questions offer it as `root`. |
| word type | Part of speech: noun, verb, adjective, … (UD's 17 "UPOS" tags). |
| relationship | How a word relates to its head: subject (`nsubj`), object (`obj`), determiner (`det`), … (UD's 37 relations). |
| treebank | Sentences annotated by people with the right tree: here, [UD English EWT](https://github.com/UniversalDependencies/UD_English-EWT) (blogs, emails, reviews, Q&A, newsgroups). It's the answer key. |
| UD conventions | The treebank's rules for which word is the head. Content words are heads, so "across" attaches to "yard" and "is" to "happy". School grammar often says the opposite. |
| phrase | Our definition, used by the phrase questions and their scoring: a word plus the little words and modifiers that hang on it ("the red ball", "across the yard", "has not seen"). See `src/gold.ts`. |
| question set | One kind of question asked about many words, e.g. "Which word does this word attach to?" for every word. Each lives in `src/question-sets/`. |
| call | One round of questions sent together. Jev answers them independently; later calls can use earlier answers. |
| vote | A question set's probabilities for each word's possible heads. Votes from several sets are multiplied together. |
| tree builder | Code that picks the highest-scoring set of attachments that forms a valid tree with one main word (Chu-Liu/Edmonds). |
| cleanup rules | Two code rules that apply UD conventions to Jev's answers (dial 3). |
| Jev dial | How much of the job Jev does in a design, from 0 (all code) to 4 (Jev does nearly everything). `rung` in the code. |
| separation | Top probability ÷ second probability. Near 1 is a close call; large means clear-cut. |
| UAS / LAS | Standard names for "attached right" and "+ relationship". |
| oracle | A fake Jev that answers from the treebank, to test the code around Jev. |
