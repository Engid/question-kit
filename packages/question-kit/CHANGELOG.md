# Changelog

## 0.4.0 (unreleased)

- **Bun can import the package.** The published `exports` pointed Bun at TypeScript source
  that isn't in the package, so `import "question-kit"` failed under Bun in every earlier release
  ("Cannot find package"). Bun now uses the built files, like Node. `bun run check:bun-package`
  installs the packed package with Bun and checks every entry, as `check:node-package` does for Node.
- **TypeSafe's SDK 0.7** (`@typesafe-ai/sdk@^0.7.0`). Under Bun, `question-kit/typesafe` works around
  the SDK's "Body already used" bug, so every request works there too. The workaround goes away once
  the SDK or Bun is fixed; a test says when.
- **Node 22 or later** (`engines`), as the SDK requires. Checked on Node 22.18, Node 24 and Bun.
- **A pinned model on every request.** `typesafeJev()` always sends a model: its `model` option,
  else `TYPESAFE_DEFAULT_MODEL`, else `DEFAULT_JEV_MODEL` (`"jev-1.13.0"`). Before, a request with no
  model got whatever `jev-latest` pointed to, which is now 1.14. Pass
  `model: "jev-1.14.0"` (or `"jev-latest"`) for the newer one. The client's `.model` names it.
- **`cachedJev` keeps answers per model:** a request's `model`, else the new `model` option, else the
  client's. jev-1.13.0 is keyed with no model, exactly as entries recorded before 0.4 are, so
  existing caches replay unchanged; any other model gets its own entries. To replay another model
  without a client: `cachedJev(undefined, dir, { mode: "replay", model: "jev-1.14.0" })`.
- **Examples on Node and Bun:** every example and the smoke checks have a `:node` script
  (`npm run pizza:node`), and `examples:node` / `examples:bun` run them all with no key. The pizza
  web server is on `node:http` and esbuild instead of Bun's own APIs. `smoke` takes `--model`.
- The source keeps to syntax Node can strip (`erasableSyntaxOnly`), so it runs on Node 22.18+
  without a build.

## 0.3.0 (2026-10-17)

- **Install with TypeSafe's SDK 0.6** (`@typesafe-ai/sdk@^0.6.0`): SDK 0.7.0 fails every request
  under Bun ("Body already used"), and Bun's installer picks it over the peer range. The peer range
  stays `^0.6.0`.
- **Node:** the tests now run under Node as well as Bun (`bun run test:node`, with vitest), and
  `bun run check:node-package` installs the packed package with Node and checks every entry.
  Checked on Node 20 and 22. Getting started has a "Node or Bun" section.
- **`lint`** warns when a Noul's criteria give one side only.
- **"None of these" where a Choice may have no right answer**: `callFunction`'s one-of-a-list
  arguments (all functions' arguments are asked in one request, so most don't apply), `pickOne`'s
  close look, and `search`'s line and block questions. A "none" argument is read as not given (its
  default, or null, and listed in `omitted`); a "none" close look is no match (`no-fit`). `search`
  still decides found or not from its "answered" question. Some models refuse a Choice where
  nothing fits rather than pick one.
- **`classifyTree`**: each level's question has a "none" option; a branch whose subcategories don't
  fit gets a lower score instead of a forced pick.
- **`callFunction`**: the "is this argument given?" questions are now `<function>.<param>.stated`
  instead of `<function>.<param>?`, so every host on OpenRouter takes them. Recorded answers still
  apply (ids aren't part of the cache key).
### Experimental

New: experimental parts live under `question-kit/experimental/…` and can change in any release,
including a patch ([what experimental means](https://docs.questionkit.dev/experimental)).

- **`question-kit/experimental/openrouter`**: `openRouter({ model })`, a client for OpenRouter's
  Decisions API, which serves Jev and other System One models behind the same request shape.
  - It retries like the TypeSafe client.
  - Question ids some hosts refuse (anything but up to 100 letters, digits, `_`, `.` and `-`, such
    as `runAll`'s `<task>::<question>`) are renamed on the way out and back on the way in.
  - Requests over a host's limits (Clef's: 64 questions, and 16k to 64k tokens by host; or
    `maxQuestions` and `maxTokens`) are sent as several and the answers put back together. A host
    that says a request is too big gets it again in halves.
  - It refuses a Noul whose criteria give only one side before sending (OpenRouter answers 400),
    treats an answer without probabilities as an error, and reports a model's refusal as its own
    error kind.
  - question-kit is built and tuned on Jev; other models get the same requests unchanged.

## 0.2.0 (2026-10-11)

- **`rankByScore`**: put a list in order by rating each item on levels you write (one Score per
  item, all in one request), sorted by the expected level: the probability-weighted average of the
  levels, so items that share a most likely level still come apart. Reports each item's expected
  and most likely level, its confidence, and the chance it rates above the next one. The first
  thing to try for ranking; in our evals it ordered lists about as well as `rankPairwise`, and
  better on some, for fewer questions.
- **`rankPairwise`**: put a list in order by asking, for each pair, which of the two is better (one
  two-option Choice per pair, all in one request, alternating which item is offered first), then
  fitting Bradley–Terry strengths to the answers. For judgements that are easier side by side than
  on a scale: relevance, quality, closeness in meaning (in our evals, a Score per item sorted by its
  expected level ordered about as well, for fewer questions; see the method's doc for when to use
  which). Reports each item's strength and the chance
  the top item beats the runner-up. `bothOrders` asks each pair twice and reports `orderGap`, how
  much the offer order moved the answers; `opponents` compares each item with only k others for
  longer lists. `rankFromDuels`, `bradleyTerry`, `pairsFor` and `firstOf` are exported too.
- **The methods have been through evals of their own**, and these changed as a result:
  - `extractDate` reads dates counted from today ("in three days", "two weeks ago", "a week from
    today"), month ends ("the end of this month") and a bare day of the month ("on the 2nd", with
    the month chosen the way the year already was; the result says `monthGuessed`, and
    `verifyRecord`'s date checks carry it and compare the day alone). Three more Choices per
    request (`span`, `count`, `period`). When the "how is the date given" part disagrees with
    the detail parts, the details are assembled anyway and the result is flagged for review; when
    both readings make different dates, the other is in the note.
  - `recoverStructure` asks, per pair of neighbouring blocks, whether they are entries of the same
    list, and types a linked run as list items together; each block reports `list`, the
    probability it continues the list before it. Fixes lists of full sentences coming back as
    paragraphs. In text with blank lines it also asks, per pair of lines with no blank between,
    whether the line starts a new unit, and joins a line that almost certainly doesn't even at a
    sentence end (`joinBelow`, default 0.1): fewer paragraphs split at a wrapped sentence end.
  - `search`'s "is it answered at all?" question is rewritten against lines that are on the topic
    without holding the answer, and `absentBelow` defaults to 0.7 (was 0.35), so by default a
    question is answered or not found; lower it to get "partly" back. A `confirm` option asks a
    second request about the top line and takes the lower answer.
  - `verifyRecord`'s `flagAbove` defaults to 0.8 (was 0.7): as many planted errors caught, half the
    false alarms on correct records.
  - `pickOne`'s `fitsBelow` defaults to 0.7 (was 0.3): the fit check is what rejects requests
    nothing covers, and 0.3 let most of them through. The fit question now asks whether the
    option is the one the text is about, rather than whether it "covers" what the text asks for.
    The scale depends on the catalog (records read low even when the pick is clear), so set it
    from your own cases; the order example uses 0.2. Its doc and `classifyTree`'s now say when the
    one-Choice `classify` is the better call.
- **The order taker is built on the building blocks.** `question-kit/order` asks the same
  questions as before, now as `choose` and `check` tasks sent with `runAll`. `defineMenu`,
  `takeOrder` and the result are unchanged. Gone: `ask`, `topChoice`, `yes`, `wordTagQuestions`,
  `checkQuestions`, `pickQuestion`; in their place `wordTags`, `orderChecks`, `pickOrder` (each a
  set of tasks for `runAll`, plus what every question is about), `wordsState`, `checkState` and
  `pickState`. Question ids now carry the task's name (`tag_w3::choice`, `check_i1::check`).
- **`run` and `runAll` take `about`:** what each task is about, by task name, kept in the request's
  `meta` under the task's question ids and never sent. For logs and explaining results.
- **`check`, `checks` and `rate` take their question as a function of the text's `Ref`**, the way
  `choose` already did: `check(ref("summary"), (s) => q\`Is ${s} wrong anywhere?\`)` writes the
  whole question instead of "About \`summary\`: …". A plain string works as before.
- **The answer cache ignores question ids.** `cachedJev` keys a request on its model, state and
  question bodies in order; TypeSafe doesn't send ids to the model. A cached answer replays under
  whatever ids the request uses. Caches written by 0.1 use the old key: `rekeyCache(dir)` from
  `question-kit/cache` moves every entry to its new key once (each entry holds its request, so
  nothing is lost), or let the cache fill again.
- **A skill for coding agents ships in the package:** `skills/question-kit/SKILL.md` (the mental
  model, which method for which job, composing them, thresholds, testing, the traps) with
  `reference.md` (every export, with options and defaults) beside it, in the Agent Skills format.
  It's in `node_modules/question-kit/skills/` after an install, and mirrored at the repository
  root for `npx skills add Engid/question-kit`.
- **Two tutorials** in the repository's `docs/tutorials/`: sorting a support inbox with the core
  methods (with the runnable `examples/triage`), and building a service agent step by step.

## 0.1.0

First release: the building blocks, the service agent, the order taker, and the pizza-shop demo.
