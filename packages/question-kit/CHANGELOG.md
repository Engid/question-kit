# Changelog

## 0.2.0 (unreleased)

- **The order taker is built on the building blocks.** `question-kit/order` asks the same
  questions as before, now as `choose` and `check` tasks sent with `runAll`. `defineMenu`,
  `takeOrder` and the result are unchanged. Gone: `ask`, `topChoice`, `yes`, `wordTagQuestions`,
  `checkQuestions`, `pickQuestion`; in their place `wordTags`, `orderChecks`, `pickOrder` (each a
  set of tasks plus what every question is about), `wordsState`, `checkState`, `pickState`, and
  `askAll` to send a set. Question ids now carry the task's name (`tag_w3::choice`,
  `check_i1::check`).
- **`check`, `checks` and `rate` take their question as a function of the text's `Ref`**, the way
  `choose` already did: `check(ref("summary"), (s) => q\`Is ${s} wrong anywhere?\`)` writes the
  whole question instead of "About \`summary\`: …". A plain string works as before.
- **The answer cache ignores question ids.** `cachedJev` keys a request on its model, state and
  question bodies in order; TypeSafe doesn't send ids to the model. A cached answer replays under
  whatever ids the request uses. Caches written by 0.1 use the old key: re-key them once with the
  script in the lab (every entry holds its request, so nothing is lost), or let them fill again.

## 0.1.0

First release: the building blocks, the service agent, the order taker, and the pizza-shop demo.
