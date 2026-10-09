# The pizza shop, step by step

A counter where you order pizza and drinks over a few messages, change your mind, and get an order
number. It's in the repository at `examples/pizza-shop`, as a terminal chat and as a web page, and
it shows Jev's thinking beside the conversation: every reading, its confidence, and what the code
did with it.

```sh
git clone https://github.com/Engid/question-kit && cd question-kit
bun install
echo "TYPESAFE_API_KEY=..." > .env
bun run pizza            # the terminal chat (--trace shows every question; --quiet hides the reads)
bun run pizza:web        # the same counter at http://localhost:8787
bun run pizza --fake     # no key: a rule-of-thumb stand-in answers instead of Jev, to see the screen
```

A session, as the terminal shows it (Jev's own numbers, replayed from the cache):

```
 You    a large pepperoni pizza

 ┊ Jev  intent → order  1.00 ✓
 ┊ Jev  "a large pepperoni pizza" → add (1 large pizza with pepperoni)  1.00 ✓
 ┊ Jev  done ordering? → no  0.74 ✓
 ⚙ Register  add-items: added 1 large pizza with pepperoni
 ┊ Jev  check → nothing looks wrong  P(wrong) 0.06

 Agent  Got it: 1 large pizza with pepperoni. Anything else?

 ┌ Order ──────────────────────────────────┐
 │ 1  1 large pizza with pepperoni  $16.49 │
 │    Total                         $16.49 │
 └─────────────────────────────────────────┘

 You    what drinks do you have?

 ┊ Jev  aside → drinks  1.00 ✓
 ┊ Jev  "what drinks do you have?" → nothing  1.00 –
 ┊ Jev  done ordering? → no  0.90 ✓

 Agent  We have coke ($2.49), diet coke ($2.49), sprite ($2.49), lemonade ($2.99), iced tea ($2.99) and water ($1.99), as a can, 20 oz ($2.49) or 2 liter ($3.99). Anything else?

 You    a lemonade

 ┊ Jev  "a lemonade" → add (1 lemonade)  0.99 ✓
 ┊ Jev  done ordering? → no  0.64 ✓
 ⚙ Register  add-items: added 1 lemonade
 ┊ Jev  check → nothing looks wrong  P(wrong) 0.10

 Agent  Got it: 1 lemonade. Anything else?

 ┌ Order ──────────────────────────────────┐
 │ 1  1 large pizza with pepperoni  $16.49 │
 │ 2  1 lemonade                     $2.99 │
 │    Total                         $19.48 │
 └─────────────────────────────────────────┘

 You    that's all

 ┊ Jev  "that's all" → nothing  1.00 –
 ┊ code  phone number → nothing that looks like one
 ┊ Jev  done ordering? → yes  0.92 ✓

 Agent  What's a good phone number to text you when it's ready?

 You    479-555-0100

 ┊ Jev  phone number → +14795550100  1.00 ✓

 Agent  Send it to the kitchen and text (479) 555-0100 when it's ready?

 You    yes

 ┊ Jev  go ahead? → yes  1.00 ✓
 ⚙ Register  place-order: order #978 sent to the kitchen, $19.48

 Agent  You're order #978, $19.48. We'll text (479) 555-0100 when it's ready. Thanks! Grab a seat.

```

## The shop, as data

The whole service is about forty lines (`examples/pizza-shop/shop.ts`):

```ts
export const shop = defineService({
  intents: {
    order: { name: "Order food", description: "The customer wants pizza or drinks, or is still ordering.", examples: ["can I get a large pepperoni?"] },
    // Asides: answered whenever they come up, then the order carries on (or starts).
    hours: { name: "Opening hours", description: "The customer asks when the shop is open or closes.", aside: true },
    menu: { name: "The menu", description: "The customer asks what's on the menu, what there is, or what something costs.", aside: true },
  },
  slots: {
    items: { label: "order", menu: pizzaMenu() },        // read by question-kit/order
    line: { label: "item", from: "order" },             // one of the lines the register reported
    phone: { label: "phone number", pattern: "phone", ask: "What's a good phone number to text you when it's ready?" },
  },
  tools: {
    "add-items": { name: "Add", description: "add one or more new items to the order", needs: ["items"] },
    "change-item": { name: "Change", description: "change an item already on the order", needs: ["line", "items"] },
    "remove-item": { name: "Remove", description: "take an item off the order", needs: ["line"] },
    "place-order": { description: "send the order to the kitchen", needs: ["phone"], changes: true },
    "show-menu": { description: "show the menu" },
  },
  procedures: {
    order: [{ repeat: ["add-items", "change-item", "remove-item"], ask: "What can I get for you?", more: "Anything else?" }, "place-order"],
    hours: [{ say: "We're open 11am to 11pm every day." }],
    menu: ["show-menu"],
  },
  wrapUps: 0,
});
```

Four things to notice.

**The order isn't the agent's.** The app owns it, in a made-up register (`register.ts`): lines
with prices and a total. The agent only ever decides which register tool to call with what; the
register does it and reports back the current lines, so the next message can say "the second one".

**Ordering is a repeat step.** The customer drives it: each message is read into phrases, Jev
picks what each phrase calls for (one of the step's tools, on one of the lines, or nothing), the
calls are made in order, and the agent asks "Anything else?" until the customer says they're done.
Then the procedure carries on to placing the order.

**The menu is the order kit's.** The `items` slot has a `menu`, so `question-kit/order` reads
the items: sizes, styles, toppings with "extra" and "no", drinks, the ways customers say each.
The register prices them.

**Hours and the menu are asides.** "What time do you close?", "what do you have?", "what kinds of
crust are there?" or "do you have breadsticks?" can come at any point. The agent answers (the
hours and the menu questions from say steps written from the menu data; the whole menu from a
`show-menu` tool the register answers) and carries on: at the start it then asks "What can I get for
you?", mid-order it goes back to "Anything else?". Every message is read for asides, with one
Choice riding along in the request the message gets anyway.

## What Jev is asked, per message

Take the second message above, with two lines on the order.

1. **The items.** The order kit tags the words the menu doesn't know with one Choice each ("what is
   `words.w1` in this order?"), then assembles the items in code. Here the menu knows every word
   that matters, so this request is small. The phrases are the stretches of the message ending in
   each item: "actually put mushrooms on the pizzas", "and take off the coke".
2. **What each phrase does, and whether the customer is done**, in one request. For each phrase,
   a Choice whose options are built from the step's tools and the order's lines:

   | Option | Description |
   | --- | --- |
   | `add-items` | Add: add one or more new items to the order |
   | `change-item@1` | Change: 2 large pizzas with pepperoni |
   | `change-item@2` | Change: 1 diet coke |
   | `remove-item@1` | Remove: 2 large pizzas with pepperoni |
   | `remove-item@2` | Remove: 1 diet coke |
   | `none` | Nothing on the order: it doesn't add, change or remove anything. |

   The state holds the message, the order so far, and the phrases; the question points at the
   phrase (`phrases.p1`) and says what the rest is. A phrase that names no items (just "take that
   off") isn't offered the tools that need items. A Noul asks whether the customer says they've
   finished ordering.

   This is TypeSafe's
   [find-and-pick](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook.md)
   pattern: code lists the options it can, Jev picks.

Each pick at or above the gate (0.7 by default) becomes a call. The register changes line 1,
removes line 2, and says what it did, reading the whole order back after a change so the customer
can catch a mistake.

3. **A check of what the calls made of the order**, one more request: the order's lines read back
   next to the conversation, with a Noul per line ("is this line wrong: not what the customer
   asked for, or a different size, number or detail?") and one for "did the customer ask for
   something that's missing?", phrased so that yes means wrong, as in the order kit's verification
   cascade. If any answer gives P(wrong) of 0.3 or more (`readBackAt`), the agent reads the whole
   order back and asks "Is that right?" instead of "Anything else?"; the reply is read as yes or a
   correction, and a correction is handled like any other message.

When the customer says they're done, the repeat step is over. The next step, placing the order,
needs a phone number: the agent asks, Jev picks the number from the candidates the pattern found,
and because placing the order is a change, the agent reads it back first. "Yes" is read as a Noul;
the register places the order and hands out a number.

## The register

`register.ts` is forty lines of app code, and the part you'd write for your own system. Each tool
returns the current lines as `records` (so `from` slots can pick among them) and a `say` (so the
agent reads the change back). Changes merge the customer's words into the line: a size replaces, a
topping is added or marked "no", a number sets how many. Removing a line that's already gone
answers with a `say` ("Sorry, which one should I take off?") and the agent asks again. A change
that says a smaller number than the line has ("make one of them a medium") splits the line.

## The web page

`examples/pizza-shop/web` is the same counter in a browser. The agent and the register run in the
page (`app.ts`, bundled for the browser by the server when it starts); a small Bun server
(`server.ts`) serves the page and forwards its System One requests to Jev with the key from `.env`,
so the browser never sees the key. The right side is the order board and a list of every request
to Jev, each of which opens to show its questions and top answers. It isn't hosted anywhere; run it
locally.

## Checking it

`examples/pizza-shop/conversations.ts` is a scripted set of about thirty orders: what the customer
sets out to say (adds, changes, removals, "that's all" in the same message as an item, hours and
the menu at the start and mid-order, small talk, splitting a line), and the lines the
order should end with. `bun run pizza:check` plays the customer: it says its moves, then answers
the agent's questions from the gold order. It says "that's all" or "yes" only when the register
matches the gold, corrects it otherwise ("no, take off the coke"), and gives up after two
corrections. A case passes only if the order is right when the customer agrees to it, so the
script can't approve a mistake the way a real customer who wasn't paying attention might. `--client
replay` uses cached answers only; `--client fake` is a smoke test of the plumbing without Jev.

## Not handled yet

Delivery (an address, a driver: a different flow after the order is taken), and questions the
menu doesn't answer ("is the sausage spicy?").
