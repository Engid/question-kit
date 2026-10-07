# pizza-order-taker

Takes a pizza order in one message ("i need one pizza pesto more cheese and don't include tuna")
and returns a structured order, a read-back line per item, and whether to accept the order as is
or read it back to the customer first. Code reads what the menu knows; [Jev](https://docs.typesafe.ai)
reads the words it doesn't and checks the finished order.

It packages the best designs from [the pizza experiment](../../examples/pizza/README.md), and is
verified against them on Amazon's PIZZA benchmark (below).

## Use it

```ts
import { defineMenu, takeOrder } from "./lib/pizza-order-taker/index.ts";

const menu = defineMenu({
  sizes: { SMALL: ["small"], MEDIUM: ["medium"], LARGE: ["large", "big"] },
  styles: { THIN_CRUST: ["thin crust", "thin"], DEEP_DISH: ["deep dish"] },
  toppings: { HAM: ["ham"], OLIVES: ["olives", "black olives"], GREEN_PEPPERS: ["green peppers", "green pepper"], CHEESE: ["cheese"] },
  drinks: { COKE: ["coke", "cokes", "coca cola"], DIET_COKE: ["diet coke"] },
  containers: { CAN: ["can", "cans", "can of"] },
});

const order = await takeOrder("two large pizzas with ham and more cheese and a diet coke", menu, jev);

order.items;     // [{ kind: "pizza", number: 2, size: "LARGE", styles: [], toppings: [{ name: "HAM" }, { name: "CHEESE", quantity: "EXTRA" }] },
                 //  { kind: "drink", number: 1, drink: "DIET_COKE" }]
order.readBack;  // ["2 large pizzas with ham and extra cheese", "1 diet coke"]
order.accept;    // true: every check answer says the order is probably right
order.confirm;   // { items: [], missing: false }: what to read back when accept is false
```

`jev` is anything with a `systemOne(request)` method. With TypeSafe's SDK:

```ts
import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { JevClient } from "./lib/pizza-order-taker/index.ts";

const client = new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY! });
const jev: JevClient = {
  // Send only state and questions: `meta` describes each question for logs and must not be sent.
  systemOne: async ({ state, questions }) => (await client.systemOne({ state, questions } as any)) as any,
};
```

In this repo, `bun run order "…"` takes an order with the full PIZZA menu and prints every step.

## What it does

1. **Code** looks every word up in the menu, longest phrase first: "black olives" → olives,
   "a little" → light, "no" → not.
2. **Jev, one call:** for each word the menu doesn't know, "what is this word in the order?" One
   Choice over the whole menu: every number, size, style, topping, drink, container and volume,
   plus "no", "extra", "light", "the pizza itself" and "nothing". ("more" → extra, "coca-colas" →
   coke, "jalepenos" → jalapeno peppers.)
3. **Code** groups the words into items: a number starts a new item, a drink after a pizza starts
   a new item, "no"/"without" turn the toppings after them into "leave it off" until "with".
4. **Jev, one call:** the order read back next to what the customer said. Is each item wrong? Is
   anything missing? Is the whole order wrong? (Phrased so yes means wrong, as in TypeSafe's
   [verification cascade](https://docs.typesafe.ai/cookbooks/sde_cascade.md).)
5. **Accept** the order if every item answer and the "anything missing?" answer give P(wrong)
   under `readBackAt` (default 0.3). Otherwise `confirm` lists the items to read back, and whether
   to ask "anything else?".

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `design` | `"gaps"` | `"gaps"`: the menu tags what it knows, Jev the rest. `"every-word"`: Jev tags every word (for a menu without good lists of ways to say things). `"pick"`: both; when their orders differ, Jev picks the one the customer said. |
| `check` | `true` | Ask Jev whether the order read back is wrong (step 4). Without it, an order is accepted when every word tag Jev gave was at least 90% sure. |
| `readBackAt` | `0.3` | Read the order back when any check answer gives P(wrong) at least this. Lower reads back more orders and lets fewer mistakes through. 0.3 is the edge of the "uncertain" band (0.30–0.70) in TypeSafe's [self-consistency cookbook](https://docs.typesafe.ai/cookbooks/consistency_noul_cookbook.md). |

## The result

| Field | What it is |
| --- | --- |
| `items` | Pizzas (`number`, `size`, `styles`, `toppings` with `quantity` and `not`) and drinks (`number`, `size`, `drink`, `container`, `volume`), holding menu ids. |
| `readBack` | One line per item, with the menu's names. |
| `accept`, `confirm` | Accept as is, or which items to read back and whether to ask about anything missing. |
| `check` | P(wrong) for each item, for "anything missing?", and for the whole order in one question. |
| `words` | How each word was read: its tag, whether the menu or Jev tagged it, and Jev's probability. |
| `confidence` | The lowest probability among Jev's word tags. |
| `pick` | With `design: "pick"`: whether the designs agreed, and which order Jev picked. |
| `calls`, `notes` | Every Jev request with its answers, and what code did between them. |

## How well it works

On the 1,357 PIZZA test orders (written by people; the designs were built on the 348 dev orders):

| Design | Whole order right | $ per 1,000 orders |
| --- | --- | --- |
| `gaps` (default) | 95.1% | 1.43 |
| `every-word` | 95.1% | 2.95 |
| `pick` | 96.3% | 4.35 |

The paper that introduced the benchmark reports 68.0% for its grammar parser and 78.6% for its
best trained model ([Arkoudas et al. 2022](https://arxiv.org/abs/2212.00265)).

How the check sorts orders, with the default design (test; how many of the 66 wrong orders would
be accepted without a read-back):

| Read back when any check answer is at least | Orders accepted as is | Wrong orders accepted |
| --- | --- | --- |
| 0.5 | 86.8% | 15 |
| **0.3 (default)** | **75.7%** | **7** |
| 0.2 | 68.1% | 3 |
| (no check: accept when every word tag ≥ 0.9) | 47.7% | 6 |

The 0.5 cut-off was chosen before the test run; the others were looked at afterwards on both
splits, so treat them as the shape of the trade-off rather than held-out estimates. On dev, 0.3
and 0.2 let none of the 9 wrong orders through.

**Verified against the experiment:** with the PIZZA menu, the library sends Jev exactly the
requests the experiment measured (byte for byte), and builds exactly the same orders.
`bun run pizza:verify-library --split test` replays all 1,357 test orders through both and
compares them order by order: identical for all three designs. The unit tests check the
questions and the rules (on all 1,705 dev and test orders) without calling Jev.

## Limits

- One message, one order. Changing an order ("actually make that a medium") needs a conversation
  layer on top; that's the next step.
- Pizzas and drinks only, with the fields above. Other kinds of item need new rules.
- English, and only as good as the menu's lists of ways to say things, for the words code tags.
  The PIZZA menu came with big lists; a menu written from scratch needs them, or `design:
  "every-word"`. How well a hand-written menu does is untested.
- The check catches most wrong orders but not all (7 of 66 got through on test at 0.3).
