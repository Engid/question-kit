# The pizza shop

A counter where you order pizza and drinks over a few messages, change your mind, and get an
order number. It's built with `question-kit/service-agent` and `question-kit/order`, and shows
Jev's thinking beside the chat: every reading, its confidence, and what the code did with it.

```sh
bun run pizza                # chat at the counter (needs TYPESAFE_API_KEY in .env)
bun run pizza --trace        # also print every question Jev was asked, with its top answers
bun run pizza --quiet        # just the chat
bun run pizza --replay       # cached answers only; never calls the API
bun run pizza --fake         # no key: a rule-of-thumb stand-in answers instead of Jev
bun run pizza:web            # the same counter as a web page, at http://localhost:8787 (--replay and --fake work here too)
```

## A session

This one ran with `--fake`, so the numbers are the stand-in's; with Jev, the screen is the same and
the numbers are Jev's.

```
 You    two large pepperoni pizzas and a diet coke

 ┊ Jev  intent → order  0.97 ✓
 ┊ Jev  "two large pepperoni pizzas" → add (2 large pizzas with pepperoni)  0.94 ✓
 ┊ Jev  "and a diet coke" → add (1 diet coke)  0.94 ✓
 ┊ Jev  done ordering? → no  0.94 ✓
 ⚙ Register  add-items: added 2 large pizzas with pepperoni
 ⚙ Register  add-items: added 1 diet coke
 ┊ Jev  check → nothing looks wrong  P(wrong) 0.02

 Agent  Got it: 2 large pizzas with pepperoni. And 1 diet coke. Anything else?

 ┌ Order ───────────────────────────────────┐
 │ 1  2 large pizzas with pepperoni  $32.98 │
 │ 2  1 diet coke                     $2.49 │
 │    Total                          $35.47 │
 └──────────────────────────────────────────┘

 You    actually put mushrooms on the pizzas, and take off the coke

 ┊ Jev  "actually put mushrooms on the pizzas" → change line 1 (1 pizza with mushrooms)  0.96 ✓
 ┊ Jev  "and take off the coke" → remove line 2 (1 coke)  0.96 ✓
 ┊ Jev  done ordering? → no  0.94 ✓
 ⚙ Register  change-item: changed line 1 to 2 large pizzas with pepperoni and mushrooms
 ⚙ Register  remove-item: removed 1 diet coke
 ┊ Jev  check → nothing looks wrong  P(wrong) 0.02

 Agent  Changed that to 2 large pizzas with pepperoni and mushrooms. Took off the diet coke. So that's 2 large pizzas with pepperoni and mushrooms. Anything else?

 ┌ Order ─────────────────────────────────────────────────┐
 │ 1  2 large pizzas with pepperoni and mushrooms  $35.98 │
 │    Total                                        $35.98 │
 └────────────────────────────────────────────────────────┘

 You    a sprite, that's all

 ┊ Jev  "a sprite" → add (1 sprite)  0.96 ✓
 ┊ Jev  done ordering? → yes  0.92 ✓
 ⚙ Register  add-items: added 1 sprite
 ┊ code  phone number → nothing that looks like one

 Agent  Got it: 1 sprite. What's a good phone number to text you when it's ready?

 You    479-555-0100

 ┊ Jev  phone number → +14795550100  0.94 ✓

 Agent  Send it to the kitchen and text (479) 555-0100 when it's ready?

 You    yes

 ┊ Jev  go ahead? → yes  0.94 ✓
 ⚙ Register  place-order: order #486 sent to the kitchen, $38.47

 Agent  You're order #486, $38.47. We'll text (479) 555-0100 when it's ready. Thanks! Grab a seat.
```

The dim `┊` lines are what Jev read (with its confidence, and `✓` when the code acted on it, `?`
when it wasn't sure enough, `–` when the answer was "none"); `⚙` lines are what the register did;
the bold line is what the agent said; the box is the order.

## How it's put together

- [shop.ts](shop.ts) describes the shop as data: the ordering intent and seven asides (opening
  hours, the whole menu, and questions about sizes, crusts, toppings, drinks or something that isn't
  sold, answered whenever they come up), three slots, five tools, and the steps for each intent. The ordering procedure is one *repeat* step (add, change or remove items until the
  customer is done) and then placing the order. It's about 60 lines.
- [menu.ts](menu.ts) is the [order example's](../order/pizza/README.md) pizza menu, with prices.
- [register.ts](register.ts) is the made-up register behind the tools. It owns the order; the agent
  never touches it. Each tool returns the current lines (so the agent can ask about "line 2") and
  what to say about it.
- [chat.ts](chat.ts) is the screen: it runs the agent turn by turn, calls the register when the
  agent asks for a tool, and prints each kind of line in its own color.
- [web/](web/) is the same counter as a page: the agent and the register run in the browser
  ([app.ts](web/app.ts), bundled by the server when it starts), and a small Bun server
  ([server.ts](web/server.ts)) serves the page and forwards its requests to Jev with the key from
  `.env`, so the browser never sees it. The order is the board on the right; each request to Jev
  can be opened to see its questions and top answers.
- [conversations.ts](conversations.ts) is a scripted set of orders: what the customer sets out to
  say, and the lines the order should end with. [check.ts](check.ts) (`bun run pizza:check`)
  plays the customer: it says its moves, then answers the agent from the gold order, saying "that's
  all" or "yes" only when the register matches it and correcting it otherwise ("no, the 2 medium
  pizzas with pepperoni should be 1 medium pizza with pepperoni"), and gives up after two
  corrections. So a case passes only if the order is right when the customer agrees to it.
  `--client replay` uses cached answers only; `--client fake` is a smoke test without Jev.

### What Jev is asked

For each customer message in the repeat step:

1. The order kit reads the message's items (one request: a Choice per word the menu doesn't know).
2. One request with a Choice per item phrase, "what does this part of the message call for?",
   whose options are the step's tools, times the lines on the order for tools that act on one
   ("Change: 2 large pizzas with pepperoni", "Remove: 1 diet coke"), plus a Noul, "the
   customer says they've finished ordering."

Each pick at or above the gate (0.7) becomes a tool call, in order; the register runs it and replies.

3. One more request, after the calls: the order's lines read back next to the conversation, with
   a Noul per line ("is this line wrong?") and one for "did the customer ask for something that's
   missing?" (the same verification cascade `question-kit/order` uses). If any answer gives
   P(wrong) of 0.3 or more, the agent reads the whole order back ("So that's …. Is that right?")
   instead of "Anything else?", and reads the reply as yes or a correction.

Then the agent asks for the phone number, reads it back, and places the order (a change, so it's
confirmed first). The pattern is TypeSafe's
[find-and-pick](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook.md): code
lists the options, Jev picks.

### Not handled yet

Delivery, and questions the menu doesn't answer ("is the sausage spicy?"). Splitting a line ("make
one of them a medium") is the register's doing: a change that says a smaller number splits the line.
