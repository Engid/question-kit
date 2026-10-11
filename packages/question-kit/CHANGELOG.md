# Changelog

## 0.2.0 (unreleased)

- **The methods have been through evals of their own**, and five changed as a result:
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
    nothing covers, and 0.3 let most of them through. Its doc and `classifyTree`'s now say when the
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
  whatever ids the request uses. Caches written by 0.1 use the old key: re-key them once with the
  script in the lab (every entry holds its request, so nothing is lost), or let them fill again.

## 0.1.0

First release: the building blocks, the service agent, the order taker, and the pizza-shop demo.
