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

The order taker's designs and its default cut-off were chosen in our evals on thousands of pizza
orders with written answers, with a much bigger menu than this one; the wording settings and
read-backs here are the same as the ones that scored best there. This small menu hasn't been
through evals of its own.
