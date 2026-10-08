# Order takers built with packages/order-kit

Each folder here is one shop's order taker: a menu described with `defineMenu`, and whatever
that shop needs around it. The library itself, and every option, is documented in
[`packages/order-kit`](../../packages/order-kit/README.md).

| Example | What it shows |
| --- | --- |
| [`pizza/`](pizza/README.md) | The menu of Amazon's PIZZA benchmark (85 toppings, 23 styles, 22 drinks, every way its catalogs say them), and how the order taker scored on the benchmark's orders. |

## Making your own

1. **List what you sell.** The kinds of item (`drink`, `pastry`), and the fields each has.
   A field has one value (size, milk), names the item (`names: true`: which drink), or is a list
   (`many: true`: extras, toppings; add `amounts: true` for "extra" and "light").
2. **List how people say each value.** `OAT: ["oat", "oat milk", "oatmilk"]`. Plurals and common
   misspellings help: code looks these up before Jev is asked anything, and every word code knows
   is a word Jev doesn't have to answer.
3. **Take orders** with `takeOrder(text, menu, jev)`. Read back the items in `confirm` when
   `accept` is false.
4. **Measure it** on orders you've written answers for, scoring whole orders (every item and
   value right). Wrap your client in `cachedJev` from `question-kit/cache` so each distinct request
   is sent once: re-running a measurement then costs nothing. The pizza example's `take-order.ts`
   shows how.

```ts
const deli = defineMenu({
  name: "sandwich and drink",
  place: "a deli counter",
  items: { sandwich: { words: ["sandwich", "sub", "sandwiches"] }, drink: {} },
  fields: {
    bread:   { items: ["sandwich"], values: { RYE: ["rye"], SOURDOUGH: ["sourdough"] } },
    filling: { items: ["sandwich"], many: true, amounts: true, values: { TURKEY: ["turkey"], SWISS: ["swiss", "swiss cheese"] } },
    drink:   { items: ["drink"], names: true, values: { LEMONADE: ["lemonade"], ICED_TEA: ["iced tea"] } },
  },
});
```
