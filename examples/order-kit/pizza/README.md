# A pizza order taker

[`packages/order-kit`](../../../packages/order-kit/README.md) with the menu of Amazon's
[PIZZA benchmark](https://github.com/amazon-science/pizza-semantic-parsing-dataset): every size,
style, topping, drink, container and volume (85 toppings, 23 styles, 22 drinks), and every way the
benchmark's catalogs say customers name them.

```sh
bun run fetch-pizza                          # once: the benchmark's orders and menu (CC BY-NC 4.0, not in this repo)
bun run order:pizza "two large pizzas with extra cheese and no onions and a diet coke"
bun run order:pizza "…" --design every-word   # or pick; --replay uses cached answers only
```

`order:pizza` prints how each word was read (by the menu or by Jev, with Jev's probability), the
order read back, the check's probabilities, and whether to accept the order or what to read back.

## Files

| File | What it is |
| --- | --- |
| `menu.ts` | The menu, described with `defineMenu`: two kinds of item (pizza, drink), six fields, the read-backs ("2 large thin crust pizzas with extra cheese and no olives", "1 diet coke, in a can"), and `toPizzaItem`, which turns an order item into the benchmark's answer format. |
| `eval.ts` | The order taker as three strategies of the pizza experiment's report card: `order-kit`, `order-kit/every-word`, `order-kit/pick`. |
| `verify.ts` | Runs each one next to the experiment's design it packages and compares them order by order. |
| `take-order.ts` | The `order:pizza` command. |

## How well it works

On the 1,357 test orders (written by people; the designs were chosen on the 348 dev orders), scored
like the benchmark's paper (the whole order must be right):

| Design | Whole order right | $ per 1,000 orders |
| --- | --- | --- |
| The paper's grammar parser | 68.0% | |
| The paper's best trained model | 78.6% | |
| `order-kit` (default: the menu tags what it knows, Jev the rest, then the check) | 95.1% | 1.43 |
| `order-kit/every-word` | 95.1% | 2.95 |
| `order-kit/pick` | 96.3% | 4.35 |

Paper: [Arkoudas et al. 2022](https://arxiv.org/abs/2212.00265).

How the check sorts orders with the default design (test; 66 orders were wrong):

| Read back when any check answer is at least | Accepted as is | Wrong orders accepted |
| --- | --- | --- |
| 0.5 | 86.8% | 15 |
| **0.3 (default)** | **75.7%** | **7** |
| 0.2 | 68.1% | 3 |
| (no check: accept when every word tag ≥ 0.9) | 47.7% | 6 |

The 0.5 cut-off was chosen before the test run; the others were looked at afterwards on both
splits, so they show the shape of the trade-off rather than held-out estimates. On dev, 0.3 and 0.2
let none of the 9 wrong orders through.

```sh
bun run pizza --split test --strategies order-kit,order-kit/every-word,order-kit/pick   # the report card
```

## Checked against the experiment

The menu's wording settings and read-backs are the ones the
[pizza experiment](../../../research/pizza/README.md) measured, so the order taker asks Jev exactly the
experiment's questions:

```sh
bun run order:pizza:verify                   # dev, from the cache (free)
bun run order:pizza:verify --split test
```

For every order it compares the requests sent to Jev (byte for byte), the order built, and the
check's probabilities. Result: identical on all 348 dev and 1,357 test orders, for all three
designs. The unit tests (test/order-kit.test.ts) also check, without calling Jev, that the menu
tags, the grouping rules, and the check and pick questions match the experiment's on all 1,705
orders.

`bun run order:pizza:verify --client live` asks Jev the dev questions again (default design, about
$0.50) and reports how often its answers change from run to run.
