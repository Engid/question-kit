# A pizza order taker

[`packages/question-kit/order`](../../../packages/question-kit/order/README.md) with a small pizza shop's menu of our own:
pizzas in three sizes and four styles, fourteen toppings, and six drinks, with the ways customers
say each one.

```sh
bun run order:pizza "two large pizzas with extra cheese and no onions and a diet coke"
bun run order:pizza "…" --design every-word   # or pick; --replay uses cached answers only
```

`order:pizza` prints how each word was read (by the menu or by Jev, with Jev's probability), the
order read back, the check's probabilities, and whether to accept the order or what to read back.

## Files

| File | What it is |
| --- | --- |
| `menu.ts` | The menu, described with `defineMenu`: two kinds of item (pizza, drink), six fields, and the read-backs ("2 large thin crust pizzas with extra cheese and no olives", "1 diet coke, in a can"). |
| `take-order.ts` | The `order:pizza` command. |

## How well it works

These numbers come from our research repo, where the same order taker ran on Amazon's
[PIZZA benchmark](https://github.com/amazon-science/pizza-semantic-parsing-dataset) with the
benchmark's own menu (85 toppings, 23 styles, 22 drinks, every way its catalogs say them). The
small menu here hasn't been measured.

On the 1,357 test orders (written by people; the designs were chosen on the 348 dev orders), scored
like the benchmark's paper (the whole order must be right):

| Design | Whole order right | $ per 1,000 orders |
| --- | --- | --- |
| The paper's grammar parser | 68.0% | |
| The paper's best trained model | 78.6% | |
| `gaps` (the default design: the menu tags what it knows, Jev the rest, then the check) | 95.1% | 1.43 |
| `every-word` | 95.1% | 2.95 |
| `pick` | 96.3% | 4.35 |

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

## Checked against the experiment

With the benchmark's menu, the order taker asks Jev exactly the pizza experiment's questions. On
all 348 dev and 1,357 test orders, for all three designs, the requests sent to Jev (byte for byte),
the orders built, and the check's probabilities were identical to the experiment's. The scoring and
this check run in our research repo, which isn't public. The menu here uses the same wording
settings and read-backs.
