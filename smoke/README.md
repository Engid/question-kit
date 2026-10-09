# Smoke checks for the core methods

A few hand-written cases per method in [`packages/question-kit`](../packages/question-kit/README.md), run
against the real model. It's a smoke test that each method's questions and code steps work end to
end, not a measurement: bigger test sets per method come later.

```sh
bun run smoke --client dry       # no Jev: how many requests, and the estimated cost
bun run smoke --client record    # call Jev for anything not cached yet, then check every case
bun run smoke                    # from the answer cache (free)
bun run smoke --only extractDate,pickOne --verbose
```

The first live run (2026-10-07, jev-1.13) was 55 requests and 34,838 input tokens, about $0.0015
at TypeSafe's list price of $0.042 per million input tokens. 41 of the 43 cases were right; the two
misses and what changed are in the next section. The dry run's estimate can differ a little,
because its made-up answers can take some methods down a different path than real ones.

## What the first run found

- **extractValue, a name from a list:** "hi it's crystal" with the names Crystal Minh and David
  Minh came back "none", by 0.52 to 0.48. The question asked which name was "as given in" the
  text, and the text only says "crystal". For names and other values from a list (rather than
  found in the text by a pattern), the question now says a shorter form, like a first name, counts.
- **verifyRecord, a correct record flagged:** two checks read the record too literally.
  - "Is the value absent from the source?" scored 0.73 for 2026-10-09 against "October 9". It now
    says a value written another way counts as supported.
  - "Does the value leave out part of what the source gives?" scored 0.91 for "blender" against
    "one countertop blender". It now asks whether the value is cut short, missing something the
    field asks for, and says extra detail can be left out.
  - The record with the invented date was flagged (0.98) and the one with the missing item was
    flagged (0.97), as they should be.
- **Estimating cost:** the live token counts fit about 253 tokens per request plus one per 3.1
  characters of request JSON. `estimateTokens` now uses that (rounded to 250 and 3), so estimates
  include the per-request cost they used to miss.

These fixes were made after seeing the cases. Four cases were added after the fixes, to check them
on texts that weren't used to make them: a nickname ("dave" for David Minh), someone not on the
account, and a correct and a wrong refund record. Names from a list are now all offered as options,
instead of only those that appear in the text, since a nickname wouldn't match.

## Second run

All 47 cases were right (59 requests, 40,794 input tokens, about $0.0017; the 8 changed or new
requests were the only calls). The margins, from the recorded answers:

- **Names from a list:** "crystal" → Crystal Minh at 0.84; "dave" → David Minh at 0.80; someone not
  on the account → "none" at 1.00.
- **verifyRecord:** wrong values were flagged at 0.97–0.98. But correct dates still scored
  0.54–0.62 on "not supported by the text", under the 0.7 flag line but in the uncertain middle.
  The text gives "October 9" or "Oct 3" with no year, and the record says 2026. Dates are better
  checked in code: read the text's date with `extractDate` and compare it, instead of asking whether
  the text supports a written-out date.

## Dates (2026-10-07)

- **verifyRecord:** date fields are no longer asked about with yes/no questions. The source's date
  is read with `extractDate` in the same request and compared in code: the month and day when the
  text gives no year, the whole date otherwise. New cases: a delivery date one day off, and a date
  the text gives relative to today ("this Friday").
- **extractDate:** with no year in the text, the year used to be this year unless that was more than
  a month ago, which put "September 1" on 2026-10-07 in 2027. Now `expect` decides (past, future,
  or by default nearest), and the result says the year was guessed. New cases: a past date with no
  year, and a bare weekday in the past.

Third run (Nick, 2026-10-07): all 51 cases right; 63 requests, about 50k input tokens. Only 7 were
new, because the three delivery-date records make the same request (a date field's value isn't in
the request; it's compared in code).

- **Dates in records:** correct dates now come out at probability 0 of being wrong (0.54–0.62
  before), and the invented date and the date one day off at 1.0.
- **"this Friday"** passed but went to review: Jev was split between "this week" (0.52) and no
  week stated (0.42). Both give the same Friday, so the confidence understates how sure the date
  is. A later fix: score the date by adding up the answers that lead to it, not by its least sure
  part.

The cases are in [`cases.ts`](cases.ts). The texts are made up (customer-service and cafe
messages, a short store policy, small records), and dates resolve against a fixed today,
2026-10-07.
