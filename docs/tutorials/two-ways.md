Note: this is an early draft written by claude. it could use some editing but is accurate in terms of the approach and reasoning.

# Tutorial: four questions, asked two ways

A System One model like Jev answers closed questions with probabilities. That makes it easy to
start: write a question, read the answer. It also makes it easy to write a question that *looks*
right, scores well one question at a time, and still gets the job wrong.

This page takes four jobs people give Jev and writes each one twice: the first way most of us
would write it, and the way that held up in our internal evals. Both versions are written by hand
against the raw API, so you can see exactly what changed. Each section ends with the question-kit
method that already does the better version, if you'd rather not write it yourself.

> [!NOTE]
> [Getting started](../getting-started.md) covers installing and connecting Jev. The hand-written
> code below uses `send(client, state, questions)`, which sends one request and returns Jev's
> answers by question id. Everything assumes a `client` from there.

## 1. Did they say it, or does it just go with what they said?

**The job:** which toppings are on a pizza someone ordered.

### The first way

One question per topping on the menu: does the customer want it?

```ts
import { send } from "question-kit";

const TOPPINGS = ["pepperoni", "sausage", "italian sausage", "black olives",
  "mozzarella", "cheddar", "peppers", "green peppers", "tomatoes", "tomato sauce" /* … */];

const answers = await send(client, { order: text }, Object.fromEntries(
  TOPPINGS.map((t, i) => [`t${i}`, {
    type: "noul",
    instructions: `Does the customer want ${t} on the pizza in \`order\`?`,
  }]),
));

const toppings = TOPPINGS.filter((_, i) => answers[`t${i}`].noul > 0.5);
```

### What goes wrong

Each of those questions, measured on its own, is right almost every time. The orders are not.

- **"Want" invites association.** "Sausage and black olives" also gets *italian sausage* (it's a
  sausage) and a combination-style pizza (it looks like one). "Pepperoni and extra cheese" also
  gets extra mozzarella and extra cheddar. Jev isn't misreading the order; it's answering the
  question asked. A customer who wants sausage plausibly *wants* italian sausage.
- **Many of those wrong answers are confident,** so a confidence cut-off doesn't save you.
- **Small errors multiply.** With a hundred independent questions per order, each one has to be
  right about 99.9% of the time for whole orders to come out right. At 99% each, about one order
  in three is fully right (0.99¹⁰⁰ ≈ 0.37).

In our evals this design was among the worst we tried on the same orders, by a wide margin,
while every individual question set looked excellent.

### The better way

Three changes, each measured on its own:

1. **Ask whether they *name* it, not whether they want it,** and say what doesn't count. Where the
   menu has a plainer and a more specific entry, say so in both directions.
2. **Don't ask about entries that can't be there.** Code knows which words the customer used; ask
   only about entries that share a word with the order.
3. **Give the answers examples,** written from the menu's own names, never from real orders.

```ts
const words = new Set(text.toLowerCase().split(/\W+/));
const candidates = TOPPINGS.filter((t) => t.split(" ").some((w) => words.has(w)));

// "sausage" vs "italian sausage": tell Jev these are different entries.
function differentFrom(t: string): string {
  const plainer = TOPPINGS.filter((o) => o !== t && t.includes(o));
  return plainer.length
    ? ` If they only say ${plainer.map((o) => `"${o}"`).join(" or ")}, that is a different entry, so the answer here is "no".`
    : "";
}

const answers = await send(client, { order: text }, Object.fromEntries(
  candidates.map((t, i) => [`t${i}`, {
    type: "choice",
    instructions:
      `Does the customer name ${t} for the pizza in \`order\`? It counts only if they say ${t}. ` +
      `Don't infer it from anything else they say.${differentFrom(t)}`,
    criteria: {
      no: { what: "Not named", examples: [`a pizza with ham`] },
      yes: { what: "Named, a normal amount", examples: [`a pizza with ${t}`, `add ${t}`] },
      extra: { what: "Named with more of it", examples: [`extra ${t}`, `lots of ${t}`] },
      not: { what: "Named as unwanted", examples: [`no ${t}`, `hold the ${t}`] },
    },
  }]),
));
```

Each change helped on its own, and together they turned the worst design into a respectable one,
for a fraction of the questions.

### Or use question-kit

The order taker goes one step further and doesn't ask per topping at all. Code looks every word
up in the menu, Jev tags only the words the menu doesn't know ("jalepenos", "xl", "i'll pass on
the peppers"), code groups the tagged words into items, and Jev checks the finished order read
back (section 2). That's the default, and among the best designs we measured.

```ts
import { defineMenu, takeOrder } from "question-kit/order";

const pizzeria = defineMenu({
  name: "pizza",
  place: "a pizza counter",
  items: { pizza: { words: ["pizza", "pie"] } },
  fields: {
    size: { items: ["pizza"], values: { LARGE: ["large", "big"], SMALL: ["small"] } },
    toppings: {
      items: ["pizza"],
      many: true,
      amounts: true,
      values: {
        PEPPERONI: ["pepperoni"],
        SAUSAGE: ["sausage"],
        ITALIAN_SAUSAGE: ["italian sausage"],
        BLACK_OLIVES: ["black olives"],
      },
    },
  },
});

const order = await takeOrder("a large pie with sausage and black olives", pizzeria, client);
order.readBack; // ["1 large pizza with sausage and black olives"]
order.accept;   // false → order.confirm says which items to read back
```

> **Take-away:** a question that is right on its own can still be wrong for the job. Ask about
> what's in the text, not what goes with it, and use code to rule out what can't be there.

## 2. "Is this right?" vs "what's wrong with this part?"

**The job:** before acting on something extracted from a message (an order, a form, a record an
LLM filled in), decide whether to accept it or check with the person.

### The first way

Read the whole thing back and ask once.

```ts
const a = await send(client, { message: text, order: readBack }, {
  ok: { type: "noul", instructions: "Is `order` exactly what the customer asked for in `message`?" },
});

if (a.ok.noul > 0.5) accept();
```

And when Jev isn't sure of something, ask it again, more narrowly.

### What goes wrong

- **One question about the whole thing lets problems hide.** An order with four right items and
  one wrong one is *mostly* right, and "is it right?" tends to agree.
- **Asking again made things worse.** We tried it: words Jev was unsure about were asked a second
  time, with only the options it had been torn between and the words around them quoted. The
  second answers broke several times as many orders as they fixed. With most options gone and the
  neighbours quoted, Jev answered for a neighbouring word. They were also rarely sure, so they
  didn't help a confidence gate either.

### The better way

Ask about each part separately, phrase every question so that **yes means wrong**, add one
question for what's missing, and let the **single worst answer** decide, so a clear problem
isn't averaged away by the parts that passed.

```ts
const lines = Object.fromEntries(readBack.map((line, i) => [`i${i + 1}`, line]));

const answers = await send(client, { message: text, order: lines }, {
  ...Object.fromEntries(Object.keys(lines).map((k) => [k, {
    type: "noul",
    instructions: `\`order.${k}\` is one line of an order read back to the customer. ` +
      `Is anything in it wrong compared with what they said in \`message\`?`,
  }])),
  missing: {
    type: "noul",
    instructions: "Did the customer ask for anything in `message` that `order` leaves out?",
  },
});

const worst = Math.max(...Object.values(answers).map((a) => a.noul));
if (worst < 0.3) accept();
else confirmWith(Object.keys(answers).filter((k) => answers[k].noul >= 0.3));
```

In our evals the per-part check caught more wrong orders than the whole-order question at the
same cut-off, and it worked on orders from any source, including orders built by code
alone. That's the point: the check doesn't care how the record was made.

Where to put the cut-off depends on what a wrong order costs you against a read-back. Ours (0.3)
sits at the edge of the uncertain band in TypeSafe's self-consistency guidance; measure a few
dozen of your own and move it.

### Or use question-kit

`takeOrder` runs this check on every order (`order.accept`, `order.confirm`). For any other
extracted record, `verifyRecord` asks several narrow yes-means-wrong questions per field (doesn't
fit, isn't supported, comes from the wrong part of the text, misses part of it, wrong format) and
one per empty field ("does the text give a value?"):

```ts
import { run, verifyRecord } from "question-kit";

const v = await run(client, verifyRecord(emailText, {
  order_number: { description: "the order's number" },
  delivery_date: { description: "when it should arrive", date: "future" },
}, extracted, { today: "2026-10-07" }));

v.ok;      // false when any one check is confident something is wrong
v.flagged; // [{ field: "order_number", check: "unsupported", probability: 0.93 }]
```

> **Take-away:** check the parts, not the whole, with questions where yes means wrong, and act on
> the worst answer. When Jev is unsure, read it back to the person rather than asking Jev again.

## 3. Ranking: the top level, or the whole answer?

**The job:** put a list in order (search results by relevance, drafts by quality, passages by
reading level).

### The first way

Rate each item on levels and sort by the level Jev picked:

```ts
const LEVELS = [
  "Unrelated to the query.",
  "On the topic, but doesn't help.",
  "Partly answers it.",
  "Answers it.",
];

const items = Object.fromEntries(passages.map((p, i) => [`i${i + 1}`, p]));

const answers = await send(client, { query, items }, Object.fromEntries(
  Object.keys(items).map((k) => [k, {
    type: "score",
    instructions: `How relevant is \`items.${k}\` to \`query\`?`,
    criteria: LEVELS,
  }]),
));

// Naive: the single most likely level.
const topLevel = (a: ScoreAnswer) =>
  Number(Object.entries(a.probabilities).sort((x, y) => y[1] - x[1])[0][0]);

const ranked = Object.keys(items).sort((x, y) => topLevel(answers[y]) - topLevel(answers[x]));
```

Or ask one Choice, "which item is most relevant?", and sort by its probabilities.

### What goes wrong

- **Items bunch up on a few levels.** Four levels and twenty items means ties everywhere, and the
  order inside a tie is whatever order the items came in. That's the reason behind a popular tip:
  don't score, compare pairs ("which of these two is more relevant?") instead.
- **One Choice is good at the top, not the rest.** It picks the best item well, but its
  probabilities past the first aren't a ranking.

### The better way

Jev doesn't return one level; it returns a probability for every level, and the answer's `score`
is the expected level: 70% "answers it", 25% "partly" and 5% "on the topic" is 2.65, not 3. Two
items that share a most likely level still come apart by how sure Jev was. Sort by that:

```ts
const ranked = Object.keys(items).sort((x, y) => answers[y].score - answers[x].score);
```

That one line is the whole fix. In our evals, sorting by the expected level ordered lists as well
as pairwise comparison or better, for fewer questions; sorting the same answers by the top level
alone ordered them worse than pairwise on every set. The pairwise tip is right about models that
return one number. Jev doesn't.

### Or use question-kit

```ts
import { rankByScore, rankPairwise, run } from "question-kit";

const byScore = await run(client, rankByScore(passages, { query, levels: LEVELS }));
byScore.ranked[0].item;    // best first, by expected level
byScore.ranked[0].beatsNext; // how likely it really outranks the next one

// When you can't write good levels, or items only make sense side by side:
const byPairs = await run(client, rankPairwise(passages, { query }));
```

> **Take-away:** don't throw away the distribution. The expected level is free, and it's most of
> what makes a Score rank well.

## 4. Sorting messages: names and a tree, or one choice with examples?

**The job:** which queue a support message belongs in.

### The first way

Label names only, asked the way an org chart reads: first the department, then the request within
it.

```ts
const dept = await send(client, { message: text }, {
  d: { type: "choice", instructions: "Which department should handle `message`?",
       criteria: { orders: null, billing: null, account: null } },
});

const within = INTENTS_BY_DEPT[dept.d.choice]; // e.g. ["where_is_it", "cancel", "return"]
const intent = await send(client, { message: text }, {
  i: { type: "choice", instructions: "Which of these is `message` asking for?",
       criteria: Object.fromEntries(within.map((n) => [n, null])) },
});
```

### What goes wrong

- **The first step is the weak one, and it can't be undone.** A message sent to the wrong
  department is then forced to pick among the wrong department's labels. In our evals one flat
  Choice over every label beat the level-by-level walk by a wide margin, on the same messages, in
  half the requests.
- **Names alone don't separate look-alikes.** `cancel` and `return` get confused both ways.
- **There's no way out.** A message that fits nothing still gets a label.

### The better way

One Choice over every label, each with a couple of real examples; a `not_for` only on the pairs
you see confused; a "none of these" option; and the department kept as a *parent* for when Jev
isn't sure which child it is.

```ts
const LABELS = {
  where_is_it: { what: "Asking where an order is or when it will arrive.",
    examples: ["where's my order?", "it was supposed to be here Friday"], parent: "orders" },
  cancel: { what: "Wants to cancel an order before it ships.",
    not_for: "returning something already delivered",
    examples: ["please cancel order 4410982", "I ordered by mistake, can you stop it?"], parent: "orders" },
  return: { what: "Wants to send something back or get money back for it.",
    not_for: "cancelling an order that hasn't shipped",
    examples: ["the jacket is too small, how do I return it?"], parent: "orders" },
  // …
};

// `parent` stays in code; only the description is sent.
const a = await send(client, { message: text }, {
  intent: {
    type: "choice",
    instructions: "Which of these best describes `message`?",
    criteria: {
      ...Object.fromEntries(Object.entries(LABELS).map(([id, { parent, ...d }]) => [id, d])),
      none: "None of these fit.",
    },
  },
});

const [best, p] = Object.entries(a.intent.probabilities).sort((x, y) => y[1] - x[1])[0];
const n = Object.keys(a.intent.probabilities).length;
const confidence = (p - 1 / n) / (1 - 1 / n); // TypeSafe's Choice confidence
const queue = confidence < 0.9 && LABELS[best]?.parent ? `${LABELS[best].parent} (unsorted)` : best;
```

What each part bought, in our evals:

- **Descriptions mostly made Jev *surer*,** not more accurate: far fewer back-offs, about the
  same number right.
- **Examples made it more accurate** and cut confident wrong answers the most, for a longer
  request. If you only do one thing, add two or three real examples per label.
- **The parent back-off** turns "unsure between `cancel` and `return`" into "orders, unsorted",
  which is right, instead of a coin flip that often isn't.

### Or use question-kit

```ts
import { classify, run } from "question-kit";

const r = await run(client, classify(text, LABELS, { backoffBelow: 0.9 }));
r.value;  // "cancel", …, or "none"
r.level;  // "parent" when it backed off
r.parent; // "orders"
```

The [triage tutorial](triage.md) builds a whole inbox sorter on this.

> **Take-away:** one choice over everything, real examples, a way out, and a broad answer you can
> trust when the narrow one isn't sure.

## Smaller things that moved the numbers

From the same evals, each measured on its own:

- **Remove options in code before asking** rather than discarding answers after. Accuracy was the
  same either way; asking about fewer options is cheaper.
- **More context in the state isn't free.** Adding information we thought would help (each word's
  neighbours, alongside the sentence) made answers worse, including on questions it had nothing to
  do with.
- **Keep the conventions in the instructions.** Taking out a paragraph that spelled out the
  conventions the answer key used cost more accuracy than any other single change, and made Jev's
  *confident* answers much less trustworthy.
- **Ask everything about one text in one request** (`runAll`): it's faster, and a question bundled
  with others nearly always got the same top answer as when asked alone.

## Why the better versions are in a library

None of the better versions above is much code, but each one took an eval to find, and several of
them run against intuition ("ask again when unsure", "more context helps", "compare pairs instead
of scoring"). question-kit's methods are those findings written down once, with defaults set from
measurement: [the building blocks](../building-blocks.md) lists them all, and every method takes
its question as a function if you want to write your own wording on top.
