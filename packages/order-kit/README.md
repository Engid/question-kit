# order-kit

Takes an order in one message, for any menu you describe, and returns a structured order, a
read-back line per item, and whether to accept the order as is or read it back to the customer
first. Code reads what the menu knows; [Jev](https://docs.typesafe.ai) reads the words it doesn't
and checks the finished order.

It packages the best designs from our pizza experiment ([the numbers](../../examples/order-kit/pizza/README.md#how-well-it-works)). [`examples/order-kit`](../../examples/order-kit/README.md)
has worked examples, starting with a pizza shop measured on Amazon's PIZZA benchmark.

It isn't published yet. In this repo it's a workspace package, so after `bun install` you import it
as `@question-kit/order-kit`.

## Use it

Describe the menu: the kinds of item, the fields they have, and the ways customers say each value.

```ts
import { defineMenu, takeOrder } from "@question-kit/order-kit";

const cafe = defineMenu({
  name: "coffee",                    // "`order` is a customer's coffee order"
  place: "a coffee counter",         // "what a customer said at a coffee counter"
  items: { drink: {}, pastry: {} },
  fields: {
    drink:  { items: ["drink"], names: true, values: { LATTE: ["latte", "lattes"], AMERICANO: ["americano", "americanos"] } },
    size:   { items: ["drink"], values: { SMALL: ["small"], LARGE: ["large", "big"] } },
    milk:   { items: ["drink"], values: { OAT: ["oat", "oat milk"], WHOLE: ["whole milk"] } },
    extras: { items: ["drink"], many: true, amounts: true, values: { SHOT: ["shot", "espresso shot"], FOAM: ["foam"] } },
    pastry: { items: ["pastry"], names: true, values: { CROISSANT: ["croissant", "croissants"] } },
  },
});

const order = await takeOrder("a large oat latte with an extra shot and no foam and two croissants", cafe, jev);

order.items;     // [{ kind: "drink", number: 1, values: { size: "LARGE", milk: "OAT", drink: "LATTE" },
                 //    lists: { extras: [{ id: "SHOT", amount: "EXTRA" }, { id: "FOAM", not: true }] } },
                 //  { kind: "pastry", number: 2, values: { pastry: "CROISSANT" }, lists: {} }]
order.readBack;  // ["1 large oat latte with extra shot and no foam", "2 croissants"]
order.accept;    // true when every check answer says the order is probably right
order.confirm;   // { items: [], missing: false }: what to read back when accept is false
```

(The cafe menu is an illustration: the unit tests use it, but no cafe orders have been measured.)

`jev` is anything with a `systemOne(request)` method. With TypeSafe's SDK:

```ts
import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { JevClient } from "@question-kit/order-kit";

const client = new TypeSafeClient({ apiKey: process.env.TYPESAFE_API_KEY! });
const jev: JevClient = {
  // Send only state and questions: `meta` describes each question for logs and must not be sent.
  systemOne: async ({ state, questions }) => (await client.systemOne({ state, questions } as any)) as any,
};
```

## The menu

| Part | What it is |
| --- | --- |
| `name`, `place` | Fill in "`order` is a customer's ___ order" and "what a customer said at ___". |
| `items` | The kinds of item, in order. The first is the default when nothing in an item says which. `words` are words for the item itself ("pizza", "pie"); `readBack` changes how it's read back. |
| `fields` | What items have. `items` lists the kinds a field belongs to. A field holds one value (size, milk), or `names: true` (which drink, which sandwich), or `many: true` (toppings, extras: each can be "no …", and with `amounts: true`, "extra …" / "light …"). `label` is how Jev's options name it ("Topping: olives"); `onlyNearItem` lists phrases that count only next to a number or an item's name ("can" in "a can of coke", not in "can i get"). |
| `values` | Each value's id, and the ways customers say it: `{ OAT: ["oat", "oat milk"] }`, or `{ OAT: { name: "oat milk", say: […] } }` to choose the name it's read back with. |
| `numbers`, `amounts`, `words` | Optional: how quantities, "extra"/"light", "no"/"without" and "with" are said. English defaults. |
| `wording` | Optional: `wordHint` (an example of a word inside a longer name, used in the word question), `details` (what an item's details are called in the check questions), `not` (how the "no" option is described). |

## What it does

1. **Code** looks every word up in the menu, longest phrase first: "oat milk" → oat, "a little"
   → light, "no" → not.
2. **Jev, one call:** for each word the menu doesn't know, "what is this word in the order?" One
   Choice over the whole menu: every number and every field's values, plus "no", the amounts, the
   words for the items themselves, and "nothing".
3. **Code** groups the words into items. A number starts a new item; so does a second name, or a
   value that belongs to another kind of item ("a latte and a croissant"). "No" / "without" make
   the list values after them unwanted until "with".
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
| `items` | `{ kind, number, values, lists }`: one-value fields as value ids, list fields as `{ id, amount?, not? }`. |
| `readBack` | One line per item. |
| `accept`, `confirm` | Accept as is, or which items to read back and whether to ask about anything missing. |
| `check` | P(wrong) for each item, for "anything missing?", and for the whole order in one question. |
| `words` | How each word was read: its tag, whether the menu or Jev tagged it, and Jev's probability. |
| `confidence` | The lowest probability among Jev's word tags. |
| `pick` | With `design: "pick"`: whether the designs agreed, and which order Jev picked. |
| `calls`, `notes` | Every Jev request with its answers, and what code did between them. |

## How well it works

Measured with the pizza menu on the 1,357 PIZZA test orders (written by people; the designs were
built on the 348 dev orders). Full details in [the pizza example](../../examples/order-kit/pizza/README.md).

| Design | Whole order right | $ per 1,000 orders |
| --- | --- | --- |
| `gaps` (default) | 95.1% | 1.43 |
| `every-word` | 95.1% | 2.95 |
| `pick` | 96.3% | 4.35 |

With the default design and `readBackAt` 0.3, 75.7% of orders were accepted as is, and 7 of the 66
wrong orders were among them.

## Limits

- One message, one order. Changing an order ("actually make that a medium") needs a conversation
  layer on top.
- English cue words and an English read-back by default.
- Code is only as good as the menu's lists of ways to say things. A menu written from scratch needs
  good lists, or `design: "every-word"`. Only the pizza menu has been measured; the default wording
  (used by menus that don't set `wording`) is untested.
- The check catches most wrong orders but not all.
