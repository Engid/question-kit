# question-kit reference (0.3.x)

Every export, by entry point, with options and defaults. Readings share three shapes:

- `ChoiceReading<K>`: `{ value: K, probability, confidence, probabilities: Record<K, number>, ranked: [K, number][] }`
- `NoulReading`: `{ value: boolean (p > 0.5), probability, confidence }`
- `ScoreReading`: `{ value: number (expected level), level (likeliest), confidence, probabilities: number[] }`

Confidence formulas (TypeSafe's): Choice `(p_max − 1/n) / (1 − 1/n)`; Noul `|2p − 1|`; Score the
spread around the most likely level against an even spread.

---

## `question-kit` (core)

### Types for Jev

- `Json`, `Entry` (string | object | array | null): state and instructions.
- `NoulQuestion { type: "noul", instructions, criteria?: { true?, false? } }`,
  `ChoiceQuestion { type: "choice", instructions, criteria: Record<id, Entry> }`,
  `ScoreQuestion { type: "score", instructions, criteria: Entry[] }`; `Question` is their union.
- `SystemOneRequest { state, questions: Record<id, Question>, model?, meta? }`;
  `SystemOneResponse { model?, answers: Record<id, Answer>, usage?: { input_tokens, output_tokens } }`.
- `NoulAnswer { noul: p }`, `ChoiceAnswer { choice, probabilities }`, `ScoreAnswer { score, probabilities }`; `Answer` is their union.
- `SystemOneClient { systemOne(request): Promise<SystemOneResponse> }`.
- `SystemOneCall { title, part, parts, request, response, ms }`: one logged request.
- `SendOptions { log?: SystemOneCall[], title?, model?, meta? }`.
- Constants: `MAX_CHOICE_OPTIONS` 255, `MAX_REQUEST_TOKENS` 48,000, `REQUEST_OVERHEAD_TOKENS` 250,
  `CHARS_PER_TOKEN` 3, `PRICE_PER_MILLION_INPUT` 0.042.

### Sending

- `send(client, state, questions, opts?: SendOptions): Promise<Record<id, Answer>>`: splits a request
  that would be too big into several (answers don't change: Jev answers each question independently).
- `estimateTokens(state, questions): number` (rounds toward over-estimating).
- `estimateCost(log: SystemOneCall[]): number` in dollars (reported usage when present, else estimated).
- `fakeJev(answer: (id, question, state) => Answer | string | number | { level }): SystemOneClient & { requests }`:
  a test client; a string picks a Choice option (p 0.9), a number is a Noul probability, `{ level }` a Score.
- `pacedJev(client, opts?: PaceOptions)`: `{ gapMs 20, jitterMs 50, tokensPerSecond 50_000 }`;
  `DEFAULT_PACE`.

### State and references

- `ref(path): Ref`; `Ref.at(name)` → child path; `Ref.path`; a `Ref` in a `q` template renders as `` `path` ``.
- `Text = string | Ref`: what methods take as the text.
- `` q`…${ref}…` ``: template tag writing backticked paths.
- `keyed(items, prefix)`: `[a, b]` → `{ prefix1: a, prefix2: b }` so each item has a path.
- `paths(state): Set<string>`, `referencedPaths(entry): string[]`.

### Questions

- `choice(instructions, options: Record<id, Option>, { none?: string | false })`: `none` adds a "none" option (id `NONE` = "none"). Default: no none option.
- `noul(instructions, criteria?: { true?, false? })`.
- `score(instructions, levels: Entry[])` (lowest first).
- `Option = string | null | OptionSpec | object`; `OptionSpec { what, not_for?, examples? }`; `describeOption(option)`.

### Readings

- `readChoice(answer)`, `readNoul(answer)`, `readScore(answer)`.
- `choiceConfidence(ps)`, `noulConfidence(p)`, `scoreConfidence(ps)`.
- `lowest(...confidences)`: the least sure (undefined ignored).
- `band(p, { no, yes }) → "yes" | "no" | "uncertain"`.
- `decide(reading, cuts | (value) => cuts, by = "confidence") → "act" | "confirm" | "person"`, with `cuts { act, confirm }`.
- `weighted(scores: Record<string, ScoreReading>, weights)`: combined score, each normalized by its levels.

### Lint

- `lint(state, questions): Problem[]` where `Problem { question, level: "error" | "warning", message }`.
  Errors: no instructions; a backticked path not in the state; a Choice with < 2 or > 255 options; a Score with < 2 levels.
  Warnings: a Noul phrased in the negative; a question asking two things; text that looks like arithmetic or counting.
- `LintError` (thrown by `run`/`runAll` on errors).

### Tasks

- `Task<T> { parts: Record<string, Json>, questions(at: (name) => Ref): Record<id, Question>, read(answers): T }`.
- `RunOptions extends SendOptions { state?: Record<string, Json>, about?: Record<taskName, unknown>, warnings?: Problem[] }`.
- `run(client, task, opts?) → Promise<T>`; `request(task, { state? })` builds without sending.
- `runAll(client, { name: task, … }, opts?) → Promise<{ name: T, … }>`; `requestAll(tasks, { state? })`.
  Ids become `task::question`; each task's parts go under its name; equal text given to several tasks is sent once.
- `place(text, name)`: a task's text part (or a pointer when it's a `Ref` / equals a caller's part).
- `nest(prefix, task)`: put a task's parts under a name.

### One-question tasks (`ops`)

- `Wording = string | ((text: Ref) => string)`: a string is placed after "About `text`: "; a function writes the whole question.
- `about(textRef, wording): string`.
- `check(text, statement: Wording, criteria?, { name? }) → Task<NoulReading>`.
- `checks(text, { id: Wording | { statement, true?, false? } }, { name? }) → Task<Record<id, NoulReading>>`.
- `choose(text, options: Record<K, Option>, { question?: Wording, none?: string | false (default "None of these fit."), name? }) → Task<ChoiceReading<K | "none">>`.
- `rate(text, question: Wording, levels, { name? }) → Task<ScoreReading>`.

### Recording gate decisions

- `GateEvent { method, task?, confidence, threshold, decision, callId?, at? }`.
- `Recorder { record(event) }`; `noRecorder`, `consoleRecorder` (stderr), `memoryRecorder()` (`.events`).
- `gate(confidence, threshold, recorder, { method, task? }) → "act" | "unsure"`.

### Methods

**`classify(text, labels: Record<K, Label>, opts?) → Task<Classified<K>>`**
`Label = string | (OptionSpec & { parent? })`. Options: `question?` (default "Which of these best describes `text`?"),
`none?: string | false` (default "None of these fit."), `backoffBelow?` (report the parent under this confidence), `name?`.
Result: `ChoiceReading<K | "none">` plus `level: "label" | "parent"`, `parent?`.

**`classifyTree(client, text, tree: TreeNode, opts?) → Promise<TreeResult>`**
`TreeNode { what?, children?: Record<id, TreeNode> }`. Options: `beam?` 3, `maxDepth?` 12, `name?`, `log?`.
Result: `{ path: string[], score, beam: { path, score }[], separation }`. One request per level. Prefer a flat `classify` with parents unless the leaves don't fit one Choice.

**`pickOne(client, text, catalog: Record<K, Candidate>, opts?) → Promise<Picked<K>>`**
`Candidate { short, full? }`; `fromRecords(records, id, describe, full?)` builds a catalog.
Options: `noun?` ("option"), `gates?: string[]` (statements true when something should be picked; default one),
`gateBelow?` 0.3, `shortlist?` 3, `fitsBelow?` 0.7 (catalog-dependent: intents read ~0.7+, a few records ~0.3–0.4 so use ~0.2), `chunk?` 240, `name?`, `log?`.
Result: `{ value: K | null, reason?: "gate" | "no-fit", probability, confidence, gate, shortlist: { id, rank, fits }[] }`. Two requests.

**`extractValue(text, opts) → Task<ExtractedValue>`**
Options: `kind: "email" | "phone" | "amount" | "number" | "zip" | RegExp (g flag) | { names: string[] } | { candidates: string[] }`,
`role` (noun phrase), `normalize?`, `countryCode?` ("1"), `name?`; with a `Ref` as text, `source: string` is required.
Result: `{ value: string | null (normalized), raw, probability, confidence, candidates }`. No candidates → no question, value null.
`findCandidates(text, kind)` is exported.

**`extractDate(text, opts) → Task<ExtractedDate>`**
Options: `role`, `today` (YYYY-MM-DD), `expect?: "past" | "future" | "nearest"` ("nearest"), `years?: [from, to]` (±10),
`bareWeekday?: "next" | "last"` ("last" when expecting the past, else "next"), `reviewBelow?` 0.6, `name?`.
Result: `{ date: string | null, confidence, review, note?, yearGuessed, monthGuessed, parts }`.
Parts read: mode, month, day, year, anchor, weekday, week, span, count, period (counted from today, month end, bare day of month included). `assembleDate(parts, today, …)` is exported.

**`callFunction(text, functions: Record<name, FunctionSpec>, opts?) → Task<FunctionCall>`**
`FunctionSpec { does, params?: Record<name, Param> }`; `Param` kinds: `one { values, default? }`, `many { values, default? }`,
`flag { default? }`, `value { extract: ExtractValueOptions minus role, default? }`, `date { date: ExtractDateOptions minus role, default? }`, each with `about`.
Options: `who?` ("the request"), `name?`. Result: `{ name: string | null, args, omitted: string[], confidence, weakest }`.

**`verifyRecord(source, schema: Record<field, FieldSpec>, record, opts?) → Task<Verified>`**
`FieldSpec { description, format?, date?: boolean | "past" | "future" | "nearest" }`.
Options: `flagAbove?` 0.8, `today?` (needed for date fields), `name?`.
Result: `{ ok, flagged: { field, check, probability }[], worst, fields: Record<field, pWrong>, dates: Record<field, DateCheck>, review: { field, note }[] }`;
`Check = "mismatch" | "unsupported" | "off_target" | "incomplete" | "format" | "missing" | "date"`;
`DateCheck { found, matches, yearGuessed, monthGuessed, confidence }`. Date fields are read with `extractDate` and compared in code.

**`checkClaim(claim, source: string | Record<section, string>, opts?) → Task<CheckedClaim>`**
Options: `quote?` (must appear in the source, else "fabricated" without asking), `section?`, `autoAbove?` 0.8.
Result: `{ verdict: "verified" | "contradicted" | "unsupported" | "fabricated", section, confidence, auto }`.

**`search(client, document: string | string[], query, opts?) → Promise<SearchResult>`**
Options: `foundAt?` 0.7, `absentBelow?` 0.7 (equal to `foundAt` by default, so "partly" is empty unless lowered), `block?` 60 (lines per block for long documents), `confirm?` false (second request on the top line; `answered` = the lower), `top?` 5, `log?`.
Result: `{ verdict: "answered" | "partly" | "not found", answered, lines: { id, line, text, probability }[] }`. 1–2 requests.

**`rerank(client, query, candidates, opts?) → Promise<Ranked[]>`**
Options: `match?: { statement, true?, false? }`, `perRequest?` 1, `concurrency?` 8, `log?`.
Result: `{ candidate, index, probability }[]`, best first.

**`rankByScore(items, opts) → Task<ScoreRanking>`**
One Score per item ("How relevant is `items.i3` to `query`?" on your levels), all in one request, sorted by expected level (the probability-weighted average level), which separates items that share a most likely level.
Options: `levels` (required, lowest first, each saying what it means), `query?` (sent as `query`), `question?` (a statement after "About `items.i3`:", or `(item, query) => string`; default with `query`: "How relevant is `items.i3` to `query`?"), `name?` "items". Needs `question` or `query`.
Result: `{ ranked: { item, index, key, value, level, confidence, probabilities, beatsNext? }[], confidence (chance the top item's level is above the runner-up's) }`. n questions, 1 request. Also exported: `above(a, b)` (chance one level distribution is above another, ties half).
In our evals it ordered lists about as well as `rankPairwise`, better on some, for fewer questions; sort by `value`, not `level`.

**`rankPairwise(items, opts) → Task<PairwiseRanking>`**
One two-option Choice per pair ("Which is <better>: `items.i3` or `items.i7`?"), all in one request, alternating which item is offered first; a Bradley–Terry fit turns the answers (each a soft win) into strengths.
Options: `query?` (sent as `query`), `better?` (finishes "Which is ___"; default "more relevant to `query`"), `question?: (a, b, query) => string`, `opponents?` (compare each item with k others instead of all; use past ~30 items), `bothOrders?` false (true asks each pair twice and reports `orderGap`), `prior?` 0.1, `name?` "items". Needs `query`, `better` or `question`.
Result: `{ ranked: { item, index, key, strength, wins, games, beatsNext? }[], confidence (chance the top beats the runner-up), orderGap? (with both orders; 0 = offer order doesn't matter), duels }`. n·(n−1)/2 questions, 1 request. Also exported: `rankFromDuels(items, duels)` (re-rank from any set of answered pairs), `bradleyTerry(wins, games)`, `pairsFor(n, opponents?)`, `firstOf(a, b)`.

**`matchRecords(a, b, opts?) → Task<Matched>`**
Options: `noun?` ("things"), `fields?: Record<field, description>`, `levels?: [different, maybe, same]`.
Result: `{ verdict: "different" | "review" | "same", score 0–2, confidence, fields: Record<field, pAgree> }`.

**`screen(text, flags: Record<id, Flag<A>>, opts) → Task<Screened<A>>`**
`Flag { statement, true?, false?, action: A }`. Options: `precedence: A[]` (most serious first; "review" and "pass" are appended),
`policy?: { act, review, escalateAtSeverity? }` (default `POLICIES.strict` = act 0.7, review 0.35; `POLICIES.permissive` = 0.85 / 0.35),
`severity?: { question, levels }`, `name?`.
Result: `{ action: A | "review" | "pass", triggered: { flag, probability, action }[], flags: Record<id, p>, severity? }`.

**`filterPassages(client, query, passages, opts?) → Promise<FilteredPassage[]>`**
Options: `rules?: Partial<PassageRules>` (`injectionAbove` 0.7, `contradictsAbove` 0.7, `relevantBelow` 0.45, `evidenceAbove` 0.55; `DEFAULT_PASSAGE_RULES`), `concurrency?`, `log?`.
Result per passage: `{ passage, decision: "include" | "conflict" | "exclude", reason, relevant, evidence, contradicts, instructions }`.

**`recoverStructure(client, text, opts?) → Promise<Recovered>`**
Options: `joinBelow?` 0.1, `log?`. Result: `{ markdown, blocks: Block[], confidence }`;
`Block { id, text, type: "heading" | "paragraph" | "list_item" | "quote" | "code" | "callout", confidence, level?, step?, list?, callout? }`.
Two requests: boundaries (mid-sentence / starts a new unit per line), then types plus "same list as the previous block" per pair. `listRuns`, `renderBlocks` exported.

**`rubric(text, items: Record<id, RubricItem>, { name? }) → Task<{ id: reading }>`**
`RubricItem = { statement, true?, false? } | { choose, options } | { rate, levels }` → Noul / Choice / Score readings.

**`featurize(client, texts, items, { concurrency?, log? }) → Promise<Record<id, number>[]>`**: probabilities per text.

**`stability(client, tasks, repeats = 5, { state?, log? }) → Promise<Record<id, QuestionStability>>`**
`QuestionStability { mean, spread, min, max, crosses }`.

---

## `question-kit/cache`

- `cachedJev(client | undefined, dir, { mode?: "record" | "replay", model? }) → CachedJev` (`.stats { hits, misses }`). Answers are kept per model:
  a request's `model`, else `model`, else the client's `.model`; `UNNAMED_MODEL` (`"jev-1.13.0"`) is keyed with no model, as entries from before 0.4 are.
  Replaying another model without a client needs `model` (`{ mode: "replay", model: "jev-1.14.0" }`).
  "record" (default): answer from the cache, else call the client and save. "replay": cache only; a miss throws `CacheMissError` (`.key`).
- `cacheKey(request)`: SHA-256 of the model, state and question bodies in order; ids are not part of it.
- `relabel(entry, request)`: a cached response mapped onto a request's ids by position.
- `CacheEntry { key, recordedAt, ms, request, response }`.
- `rekeyCache(dir, { dryRun?, keyOf? }) → RekeyReport { seen, inPlace, moved, collisions, bad }`: migrate entries written under an older key.

## `question-kit/typesafe`

- `typesafeJev(opts?: TypeSafeOptions) → SystemOneClient`. Options: `apiKey?` (TYPESAFE_API_KEY), `model?` (default TYPESAFE_DEFAULT_MODEL, then
  `DEFAULT_JEV_MODEL` = `"jev-1.13.0"`; always sent, a request's `model` wins; the client's `.model` names it), `timeoutMs?` 60,000,
  `retry?: Partial<RetryPolicy>` over `DEFAULT_RETRY` (`maxRetries` 5, backoff about 1 s → 16 s with jitter, honours Retry-After; rate limits, server errors such as 503, timeouts, dropped connections),
  `onRetry?: (message) => void | false` (default: a line on stderr), `baseURL?`, `pace?: PaceOptions | false`.
  Requires the optional peer `@typesafe-ai/sdk` 0.7 (under Bun, with a built-in workaround for its "Body already used" bug).

## `question-kit/experimental/openrouter` (experimental: can change in any release)

- `openRouter(opts: OpenRouterOptions) → SystemOneClient`, for OpenRouter's Decisions API (`POST /api/alpha/decisions`). Options: `model` (required, such as
  `typesafe/jev-1.13`; a request's `model` wins), `apiKey?` (OPENROUTER_API_KEY), `provider?` (OpenRouter routing, sent unchanged), `baseURL?`, `timeoutMs?` 60,000,
  `retry?` (as `typesafeJev`), `onRetry?`, `pace?` (default off), `maxQuestions?` and `maxTokens?` (defaults: `KNOWN_LIMITS` for the model and the hosts
  `provider` allows; a request over them is sent as several, each with the whole state, and a host's "too big" is retried in halves), `headers?`, `strict?` (default true).
- Ids hosts refuse are renamed on the wire and back. Errors are `OpenRouterError { status?, kind: "request" | "answer" | "refused" | "too-big" | "http", model? }`.
- Also: `checkRequest`, `checkAnswers`, `wireIds`, `limitsFor`, `KNOWN_LIMITS`, `splitForLimits`, `estimateOpenRouterTokens`, `OPENROUTER_BASE_URL`.
- Built and tuned on Jev; other models get the same requests unchanged. No images yet.

## `question-kit/node`

- `jsonlRecorder(path) → Recorder`: appends one JSON line per gate event.

---

## `question-kit/service-agent`

### Definition

`defineService(spec: ServiceSpec) → Service` (throws a list of problems: unknown tools/slots, a slot with not exactly one kind, a skippable change, a repeat tool that changes or needs a non-menu/from slot, an empty say/ask).

- `intents: Record<id, IntentSpec>`; `IntentSpec { name, group?, description?, examples?, notFor?, procedure? (written policy Jev reads for optional steps; default: description), aside? }`.
- `slots: Record<id, SlotSpec>`; `SlotSpec { label, role? ("the customer's {label}"), format?, ask? ("Could I have your {label}?"), normalize?, and exactly one of: pattern: RegExp | "email" | "phone" | "amount" | "number" | "zip" | list: string[] | options: Record<id, string | OptionSpec> | date: "past" | "future" | "nearest" | menu: Menu | from: string (a tool's records) }`.
- `tools: Record<id, ToolSpec>`; `ToolSpec { name?, description, needs?: Need[], changes?, instruction? (for try steps), skipIfMissing? }`; `Need = slotId | { anyOf: slotId[] }`.
- `procedures: Record<intentId, Step[]>`; `Step = toolId | { tool, needs?, fixed?, roles? } | { try: [...] } | { optional: [...] } | { say } | { repeat: toolId[], ask, more? }`.
- Options: `gates?: Partial<Gates>` (`intent` 0.9, `value` 0.9, `yesNo` 0.6 as |2p−1|, `confirm` 0.8, `policy` 0.9, `repeat` 0.7; `DEFAULT_GATES`),
  `retries?` 1, `clarifyWith?` 3, `corrections?` 2, `offerWhenUnsure?` true, `wrapUps?` 3, `readBackAt?` 0.3.
- `Service` adds `steps: Record<intentId, NormalStep[]>` (`NormalStep { index, tool, say?, needs, fixed, roles, group?, optional?, repeat? }`).

### Running

- `turn(service, log: AgentEvent[], input: TurnInput, opts: TurnOptions) → Promise<TurnResult>`.
  `TurnInput = { type: "customer", text } | { type: "result", tool, step, ok, values?: Record<slot, string>, note?, data?, records?: Record<name, { id, text }[]>, say? }`.
  `TurnOptions { client, today?, recorder?, calls?: SystemOneCall[], templates?, maxReads? 6 }`.
  `TurnResult { log, action, view, messages: string[] }`. Throws if the conversation has ended.
- `Action` types: `ask-intent`, `clarify { intents }`, `ask { slot, slots, tool, again }`, `check-value { slot, value }`, `say`, `aside-done`, `skip`,
  `call { tool, step, values }`, `confirm { tool, step, values }`, `repeat-ask { first, again }`, `repeat-check { lines }`, `ask-fixed { tool, step }`,
  `wrap-up { again }`, `handoff { reason }`, `done`; each with `text` where something is said. `Waiting` = the ones that wait for the customer.
- `view(log) → View`: `intent`, `slots: Record<id, { value, confidence, at, from: "customer" | "system" }>`, `done`, `passed`, `failed`, `fixed`, `confirmed`, `policy`, `records`, `repeat`, `pending`, `misses`, `asked`, `customerTurns`, `ended { how, reason? }`, and more.
- `transcript(log)`: the conversation as Jev reads it (`customer:`, `agent:`, `system:` lines).
- `AgentEvent` union: `customer`, `agent { text, action }`, `read-intent`, `read-aside`, `aside`, `read-slot`, `read-yes-no { about: "fixed" | "value" | "more" | "finished" | "right" }`, `read-review`, `read-repeat`, `read-confirm`, `read-policy`, `call`, `result`, `skip`, `end`; readings carry `confidence` and `outcome: "act" | "unsure" | "skip"`.
- `defaultTemplates: Templates`; `Templates { askIntent(again), clarify(intents), ask(slots, again), checkValue(slot, value), confirm(tool, values), askFixed(tool), handoff(reason), wrapUp(again), done(), repeatAsk(step, first, again), repeatCheck(lines), repeatFix() }`.
- Lower level: `readPlan(service, view)`, `read(service, events, plan, opts)`, `decide(service, view, templates)`, `position(...)`.

### Behaviour summary

Intent via one `classify` (+ "none"); under the gate, offer the likeliest `clarifyWith` and read against them; repeated misses hand off.
Values read from the whole conversation, once per customer message; under the gate, check the likeliest candidate if present, else ask again (`retries`), try an `anyOf` alternative, then hand off.
`changes: true` tools are read back and confirmed (yes / correction / no; up to `corrections`). Optional steps: Jev picks from the written `procedure`, steps done, and the conversation incl. tool `note`s; under `policy`, a change is still offered unless `offerWhenUnsure: false`.
Repeat steps: the message's items via `question-kit/order`, one pick per phrase (tool × record), gate `repeat`; after the calls, a check of the records (P(wrong) per record + "anything missing?") reads everything back at `readBackAt`.
After the procedure: "anything else?" up to `wrapUps` times; something no step covers hands off.

---

## `question-kit/order`

- `defineMenu(input: MenuInput) → Menu`. `MenuInput { name, place, items: Record<kind, { words?, readBack? }>, fields: Record<field, { items, label?, names?, many?, amounts?, onlyNearItem?, values: Record<id, string[] | { name, say }> }>, numbers?, amounts?, words?: { not?, backOn? }, wording?: { wordHint?, details?, not? } }`.
  `DEFAULT_NUMBERS`, `DEFAULT_AMOUNTS`, `DEFAULT_WORDS`.
- `takeOrder(text, menu, client, opts?) → Promise<OrderResult>`. Options: `design?: "gaps" | "every-word" | "pick"` ("gaps"), `check?` true, `partial?` false, `readBackAt?` 0.3.
  Result: `{ text, words: { word, tag, by: "menu" | "jev", p? }[], items: OrderItem[], spans, readBack: string[], check?: { whole, items: number[], missing }, accept, confirm: { items: number[], missing }, confidence, pick?, calls, notes }`.
  `OrderItem { kind, number, numberSaid?, values: Record<field, id>, lists: Record<field, { id, amount?, not? }[]> }`.
- Pieces: `tokenize`, `menuTags`, `assemble`, `wordTags`, `orderChecks`, `pickOrder` (the Jev tasks, sent with `runAll`), `readBackLines`, `readBackOrder`, `defaultReadBack`, `plural`, `sameItems`.
