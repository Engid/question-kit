# Pizza orders: the lab's lessons on a real-world task

> These are the original pizza experiments: every design we measured, the scoring, and the report
> card (`bun run pizza`). The reusable order taker built from what they found is
> [`packages/order-taker`](../../packages/order-taker/README.md), and its pizza example is
> [`examples/order-taker/pizza`](../../examples/order-taker/pizza/README.md).

The parsing lab found what Jev is good at (sorting things into a fixed list of categories) and what
it isn't (working out structure across a sentence). This example applies that to taking orders,
and measures it on a public answer key: Amazon's
[PIZZA benchmark](https://github.com/amazon-science/pizza-semantic-parsing-dataset)
([Arkoudas et al. 2022](https://arxiv.org/abs/2212.00265)).

- 348 dev and 1,357 test pizza-and-drink orders, written by people on Mechanical Turk, each with the
  right answer as a tree:
  "five medium pizzas with tomatoes and ham" →
  `(ORDER (PIZZAORDER (NUMBER 5) (SIZE MEDIUM) (TOPPING HAM) (TOPPING TOMATOES)))`.
- The menu comes with the dataset: ~85 toppings, 23 styles, 22 drinks, sizes, containers, volumes,
  and the words customers use for each ("black olives" → olives).
- Scored like the paper: the whole order must be right, ignoring the order of items and toppings.
  The paper reports 68.0% for its grammar-based parser and 78.6% for its best trained model (BART,
  trained on 2.46M synthetic orders) on test.
- The dataset is CC BY-NC 4.0 (non-commercial). `bun run fetch-pizza` downloads it, pinned to one
  commit and SHA-256 checked; it isn't included in this repo.

## The strategies

| Jev dial | Strategy | What Jev does | What code does |
| --- | --- | --- | --- |
| 0 | `keywords` | nothing | looks every word up in the menu's word lists; rules group the tags into items |
| 1 | `keywords-jev-fills-gaps` | tags only the words the lists don't know ("more", "hamburger") | the same as dial 0 for everything else |
| 2 | `code-splits-jev-fills` | answers menu questions about each item: pizza or drink, how many, size, and one question per style and per topping (did they ask for it, extra, or not?) | splits the order into items |
| 3 | `jev-tags-words` | tags every word with one Choice over the whole menu (~170 options) | the same rules as dial 0 group the tags |
| 4 | `jev-splits-jev-fills` | says where each item starts, then answers the menu questions | cuts the order where Jev said |

Experiments: `jev-tags-words/nested` (what kind of thing, then which one), `/bare-names`
versions of dials 2 and 3 (menu names only: no other spellings, no "not the same as green
peppers" notes), and `/named` versions of dials 2 and 4, where each style and topping question
asks whether the customer *names* it ("counts only if they say…; don't infer it", with notes in
both directions), plus `code-splits-jev-fills/named-candidates`, where code only asks about the
styles and toppings that share a word with the item.

Three more sets of experiments ask what a real order taker would need. They reuse the designs above,
so on orders that have already been run only the new calls cost anything:

| Experiment | What it adds | Why |
| --- | --- | --- |
| `keywords-jev-fills-gaps/follow-up`, `jev-tags-words/follow-up` | Words Jev was under 90% sure of are asked again, with only the options it was torn between plus "none", pointing at the words around it | Does a second, narrower question fix mistakes, or make more orders safe to accept? |
| `keywords+check`, `keywords-jev-fills-gaps+check`, `jev-tags-words+check`, `code-splits-jev-fills/named-candidates+check` | The finished order is read back to Jev next to what the customer said: is it wrong? Asked for the whole order, for each item, and "is anything missing?" (yes means wrong, as in TypeSafe's [verification cascade](https://docs.typesafe.ai/cookbooks/sde_cascade.md)) | Can Jev catch wrong orders, so only those are read back to the customer? |
| `pick-dial-1-or-3` | Runs dials 1 and 3; when their orders differ, Jev sees both read back and picks the one that matches | Does a second design plus a pick beat either design alone? |
| `jev-tags-words/examples`, `code-splits-jev-fills/named-candidates/examples` | Options as TypeSafe's [structured criteria](https://docs.typesafe.ai/primitives/advanced.md): what it is, what it's not for, and examples. The examples are generic (the menu's own spellings and made-up phrases), never taken from the orders | Do examples in the questions help where Jev is already good (word tags) and where it struggles (per-topping questions)? |

The pizza order taker in [`examples/order-taker/pizza`](../../examples/order-taker/pizza/README.md) packages
the best designs with [`packages/order-taker`](../../packages/order-taker/README.md). Its three designs also
run here, as `order-taker`, `order-taker/every-word` and `order-taker/pick`, and ask exactly the
questions measured above; `bun run order:pizza:verify [--split test]` compares them with these
designs order by order.

Every Jev strategy reports how an app could decide between accepting an order as is and reading it
back to the customer: when every answer used was ≥ 90% sure, when the check passes, when the two
designs agree. For each, it shows the share of orders accepted, how often those were right, and how
many of the wrong orders would have been caught.

## Run it

```sh
bun run fetch-pizza                                   # once
bun run pizza --client record                         # the lineup on the 348 dev orders
bun run pizza --client record --all                   # plus the experiments
bun run pizza:explain --id dev-17 --client replay     # one order: every question and answer
bun run pizza:explain "two large pizzas with extra cheese and a diet coke"
bun run pizza --client oracle                         # perfect answers: each strategy's ceiling, and cost estimates
bun run pizza --split test --client record            # the final numbers: run once, at the end
bun run pizza:explain --id dev-17 --strategy keywords-jev-fills-gaps+check --client replay
bun run order:pizza:verify --split test                # the order taker vs these designs, order by order (free, from the cache)
bun run order:pizza "two large pizzas with extra cheese and a diet coke"   # one order through the order taker
```

Estimated cost (from `--client oracle` request sizes, which overestimate by ~15%): about $2 for the
lineup on dev, $2 more for the first experiments, and about $9 for the lineup on test. Of the newer
experiments, the follow-ups, checks and pick add about $0.06 on dev and $0.20 on test (their first
calls are the lineup's, already cached once run); `jev-tags-words/examples` is about $1.70 on dev
and `code-splits-jev-fills/named-candidates/examples` about $0.11. `--client dry` isn't useful here:
with uniform answers, dial 4 starts a new item at every word.

## Results

On the 1,357 test orders, run once per design after it was fixed (designs were built on the 348
dev orders):

| Design | Whole order right | $ / 1k orders |
| --- | --- | --- |
| The paper's grammar parser (PCFG) | 68.0% | |
| The paper's best trained model (BART) | 78.6% | |
| `keywords` (dial 0) | 93.3% | 0 |
| `keywords-jev-fills-gaps` (dial 1) | 95.1% | 1.40 |
| `jev-tags-words` (dial 3) | 95.1% | 2.93 |
| `pick-dial-1-or-3` | **96.3%** | 4.33 |
| `code-splits-jev-fills/named-candidates` | 73.2% | 0.20 |
| `code-splits-jev-fills/named-candidates/examples` | 84.5% | 0.30 |
| `keywords-jev-fills-gaps/follow-up` | 94.3% | 1.42 |
| `jev-tags-words/follow-up` | 89.2% | 2.97 |

The `+check` designs build the same orders as their bases; what they add is a way to decide which
orders to read back. With dial 1, reading back an order whenever any item check or the "anything
missing?" check gives P(wrong) ≥ 0.3 accepted 75.7% of test orders, with 7 of the 66 wrong ones
among them (the confidence gate: 47.7% accepted, 6 wrong).

The one-question-per-topping designs (dials 2 and 4) got 8.3% and 6.0% of dev orders right as first
worded, and 69–75% after rewording. The [detailed report](../report.md#3-experiment-2-pizza-orders)
has every design, the paired tests, the gates, and why the per-topping designs failed.
