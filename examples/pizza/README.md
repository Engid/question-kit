# Pizza orders: the lab's lessons on a real-world task

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

| Rung | Strategy | What Jev does | What code does |
| --- | --- | --- | --- |
| 0 | `keywords` | nothing | looks every word up in the menu's word lists; rules group the tags into items |
| 1 | `keywords-jev-fills-gaps` | tags only the words the lists don't know ("more", "hamburger") | the same as rung 0 for everything else |
| 2 | `code-splits-jev-fills` | answers menu questions about each item: pizza or drink, how many, size, and one question per style and per topping (did they ask for it, extra, or not?) | splits the order into items |
| 3 | `jev-tags-words` | tags every word with one Choice over the whole menu (~170 options) | the same rules as rung 0 group the tags |
| 4 | `jev-splits-jev-fills` | says where each item starts, then answers the menu questions | cuts the order where Jev said |

Experiments: `jev-tags-words/nested` (what kind of thing, then which one), `/bare-names`
versions of rungs 2 and 3 (menu names only: no other spellings, no "not the same as green
peppers" notes), and `/named` versions of rungs 2 and 4, where each style and topping question
asks whether the customer *names* it ("counts only if they say…; don't infer it", with notes in
both directions), plus `code-splits-jev-fills/named-candidates`, where code only asks about the
styles and toppings that share a word with the item.

Every Jev strategy also reports a confidence gate: the share of orders where every answer used was
≥ 90% sure, and how often those were right.

## Run it

```sh
bun run fetch-pizza                                   # once
bun run pizza --client record                         # the lineup on the 348 dev orders
bun run pizza --client record --all                   # plus the experiments
bun run pizza:explain --id dev-17 --client replay     # one order: every question and answer
bun run pizza:explain "two large pizzas with extra cheese and a diet coke"
bun run pizza --client oracle                         # perfect answers: each strategy's ceiling, and cost estimates
bun run pizza --split test --client record            # the final numbers: run once, at the end
```

Estimated cost (from `--client oracle` request sizes, which overestimate by ~15%): about $2 for the
lineup on dev, $2 more for the experiments, and about $9 for the lineup on test. `--client dry`
isn't useful here: with uniform answers, rung 4 starts a new item at every word.

## Results

On the 1,357 test orders, run once at the end (designs were built on the 348 dev orders):

| Design | Whole order right | $ / 1k orders |
| --- | --- | --- |
| The paper's grammar parser (PCFG) | 68.0% | |
| The paper's best trained model (BART) | 78.6% | |
| `keywords` (rung 0) | 93.3% | 0 |
| `keywords-jev-fills-gaps` (rung 1) | 95.1% | 1.40 |
| `jev-tags-words` (rung 3) | 95.1% | 2.93 |
| `code-splits-jev-fills/named-candidates` | 73.2% | 0.20 |

The one-question-per-topping designs (rungs 2 and 4) got 8.3% and 6.0% of dev orders right as first
worded, and 69–75% after rewording. The [detailed report](../../docs/report.md#3-experiment-2-pizza-orders)
has every design, the paired tests, the confidence gate, and why the per-topping designs failed.
