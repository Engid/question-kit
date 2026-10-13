# Tutorial: build a service agent

How to go from "we'd like a bot for support chat" to a service the agent can run: what you have
to write down, in what order the needs show up, and why each part is shaped the way it is. The
finished service is the store in
[`examples/service-agent/store.ts`](https://github.com/Engid/question-kit/blob/main/examples/service-agent/store.ts),
and `bun run service:chat` talks to it.

> [!NOTE]
> [Building an agent](../service-agent.md) is the reference for every part. This page is the order
> you'd actually write it in.

The business is a small outdoor-gear store. Support gets three kinds of message: people who want
to return something, people who want their order faster, and people who can't sign in.

The agent runs the conversation from a *description* of the service. Code runs the procedure, Jev
reads the customer, and nothing is written by a language model: every line the agent says comes
from a template. So building one means three things:

1. writing the description;
2. connecting the agent to your system;
3. deciding what it does when Jev isn't sure.

## 1. What customers come for: intents

Start with the requests themselves. Each is an *intent* with a name, the company's description,
and a few things customers have actually written:

```ts
import { defineService } from "question-kit/service-agent";

const service = defineService({
  intents: {
    refund: {
      name: "Return or refund",
      description: "The customer wants to return an item or get their money back for it.",
      examples: [
        "I want to return my boots",
        "can I get a refund for order 1234567890?",
        "the jacket I got is torn",
      ],
    },
    shipping: {
      name: "Change delivery speed",
      description: "The customer wants their order to arrive sooner, or doesn't mind it arriving later.",
      examples: ["can I get my order faster?", "please upgrade my order to overnight"],
    },
    password: {
      name: "Reset password",
      description: "The customer can't sign in or has forgotten their password.",
      examples: ["I forgot my password", "I can't log in to my account"],
    },
  },
  slots: {},
  tools: {},
  procedures: {},
});
```

Under the hood this is one `classify` over the intents, with "none" for an opening that doesn't
say yet ("hi, I have a question"). The examples are the most useful thing you can give it: in our
evals of `classify`, two real examples per label did more for accuracy than any description. If
two intents keep getting confused, give each a `notFor` saying what the other one is (it's the
service agent's spelling of the core's `not_for`).

What happens when the reading is under the gate (0.9 by default) is already decided for you: the
agent offers the likeliest few ("Is this about a return, or about delivery?") and reads the reply
against just those; after repeated misses it hands off. You don't write that logic. You'll tune
the gate later, from the log.

## 2. What each request needs: slots

Now go through each request and ask what your system needs to act on it:

- a return needs the order, and the customer's email to find it;
- a faster delivery needs the order and the speed they want;
- a password reset needs the email.

Those are the *slots*:

```ts
slots: {
  order_id: { label: "order ID", format: "10 digits", pattern: /\b\d{10}\b/g },
  email: { label: "email address", pattern: "email" },
  speed: {
    label: "shipping speed",
    role: "the shipping speed the customer wants",
    options: {
      standard: "standard (5 to 7 days)",
      express: "express (2 days)",
      overnight: "overnight",
    },
  },
},
```

Every slot says *how its value is found*, and that's the part worth understanding. Jev can't write
a value out; it can only choose. So:

- for an **order ID**, code finds every ten-digit run in the conversation with the `pattern`, and
  Jev picks which one is the order ID;
- for an **email**, the built-in `email` pattern finds the candidates;
- for the **speed**, the candidates are the fixed `options`, and Jev picks the one the customer
  asked for.

The other kinds work the same way: `list` for known names, `date` for a calendar date read part by
part, `from` for one of the records a tool reported.

The value Jev picks is always text that's really there, which is what makes it safe to send to
your order system. Over-finding is fine: a phone number that happens to be ten digits is just a
candidate Jev won't pick.

`format` ("10 digits") is told to Jev along with the role, and helps most with bare values: when
the agent has just asked for the order ID and the customer types "5550001111", the question the
agent asked is what makes that an order ID. That's also why values are read from the whole
conversation, both sides.

A value under the gate (0.9) is handled for you too: if Jev's likeliest candidate is there, the
agent checks it ("Just to check, is your order ID 5550001111?"); otherwise it asks again, then
hands off.

## 3. What your system can do: tools

A tool is something your system does, named for Jev and the logs, with the slots it needs:

```ts
tools: {
  "look-up-order": {
    name: "Look Up Order",
    description: "find the order and what's in it",
    needs: ["order_id", "email"],
  },
  refund: {
    name: "Refund",
    description: "refund the price to the original payment method",
    needs: ["amount"],
    changes: true,
  },
  "store-credit": {
    name: "Store Credit",
    description: "give store credit for the price",
    needs: ["amount"],
    changes: true,
  },
  "change-speed": {
    name: "Change Shipping Speed",
    description: "change how fast the order ships",
    needs: ["speed"],
    changes: true,
  },
  "send-reset": {
    name: "Send Reset Link",
    description: "email a link to reset the password",
    needs: ["email"],
  },
},
```

Two things to notice.

**`refund` needs an `amount`, and no customer is going to be asked for it.** The order lookup fills
it in (that's in step 6). Add a slot for it anyway, so the agent knows the refund can't run until
something has supplied it:

```ts
// Filled by the order lookup, not asked for.
amount: { label: "amount", pattern: "amount" },
```

**Three tools are marked `changes: true`.** A change is anything that alters an order, an account
or money. The agent never calls one straight away: it reads the change back with its values ("Just
to confirm, I'll refund the order (amount: $120.00). Shall I go ahead?") and reads the reply as go
ahead, a correction, or no. A correction makes it read the values again with the correction in
view and read the change back again.

> [!IMPORTANT]
> This is the one place a wrong reading could do damage, so the customer is always the last gate.

The agent never *runs* a tool, either. It tells your code which one to call with which values, and
your code reports back. That's step 6.

## 4. The steps for each request: procedures

With tools in hand, each intent's procedure is a list of steps in order:

```ts
procedures: {
  refund: ["look-up-order", "refund"],
  shipping: ["look-up-order", "change-speed"],
  password: ["send-reset"],
},
```

This already runs. `defineService` checks that every procedure's tools exist, every tool's slots
exist, and nothing marked skippable is a change, and throws a list of problems if not. Then a turn
does the obvious thing: work out the intent, find the first step not done, ask for what it still
needs, call it, move on. Unless something else is going on, the agent isn't asking Jev anything
beyond "which intent?" and "which candidate?".

But the store's real procedure for a return isn't "look it up, then refund". It depends.

## 5. When the procedure has an "if": optional steps

Here's the store's actual return policy, as the company would write it for a new hire:

> Look up the order. If the item arrived damaged or isn't what they ordered, refund the full price
> to the original payment method. Otherwise, if it was delivered in the last 30 days, offer store
> credit for the full price. Otherwise the 30-day return window has passed: offer neither.

A written procedure with conditions is a judgment call, and that's what Jev is for. Put the policy
on the intent as its `procedure`, and make the steps it chooses between *optional*:

```ts
intents: {
  refund: {
    name: "Return or refund",
    description: "…",
    examples: […],
    procedure: [
      "Look up the order. Then:",
      "- If the item arrived damaged or isn't what they ordered, refund the full price to the original payment method.",
      "- Otherwise, if it was delivered in the last 30 days, offer store credit for the full price.",
      "- Otherwise the 30-day return window has passed: offer neither.",
    ].join("\n"),
  },
  shipping: {
    …,
    procedure:
      "Look up the order. If it hasn't shipped yet, change the shipping speed to the one the " +
      "customer asks for. If it has shipped, it can't be changed.",
  },
},
procedures: {
  refund: ["look-up-order", { optional: ["refund", "store-credit"] }],
  shipping: ["look-up-order", { optional: ["change-speed"] }],
  password: ["send-reset"],
},
```

At the optional step, Jev gets the written procedure, the steps done so far with their values,
and the conversation including what the tools found, and picks which optional step to do next, or
none. Nothing is summarized on the way; the state is the log, rendered as text. The pick is a
Choice like any other, with a gate (`policy`, 0.9).

What happens under the gate is a deliberate choice you should know about. A *change* Jev leans
toward is still offered, because the read-back is itself the offer and the customer decides;
anything else isn't taken. If you'd rather an unsure agent skipped the change, set
`offerWhenUnsure: false`.

For Jev to make this call, it has to know whether the item was damaged, when it was delivered,
whether it shipped. The customer says some of that. Your system says the rest, which brings us to
the loop.

## 6. Connecting it to your system: the turn loop

The agent is a function of the log so far and one input, a customer message or a tool's result.
It returns a longer log, an *action*, and what to say:

```ts
import { type AgentEvent, turn } from "question-kit/service-agent";

let log: AgentEvent[] = [];

async function onMessage(text: string): Promise<string[]> {
  let r = await turn(service, log, { type: "customer", text }, { client });

  while (r.action.type === "call") {
    // Your code: `ok`, and optionally note / values / say.
    const result = runTool(r.action.tool, r.action.values);
    r = await turn(
      service,
      r.log,
      { type: "result", tool: r.action.tool, step: r.action.step, ...result },
      { client },
    );
  }

  log = r.log;       // plain JSON: store it between messages
  return r.messages; // what the agent says this turn
}
```

A `call` action names the tool and gives its values; everything else (`ask`, `check-value`,
`confirm`, `clarify`, `wrap-up`, `done`, `handoff`…) waits for the customer. Your `runTool` is
where the store's order system lives, and its result carries three things back to the agent:

```ts
function runTool(tool: string, values: Record<string, Json>) {
  if (tool === "look-up-order") {
    const id = String(values.order_id);
    const order = ORDERS[id];
    if (!order || order.email !== String(values.email).toLowerCase()) {
      return {
        ok: false,
        note: "Look Up Order: no order with that ID and email address.",
      };
    }
    return {
      ok: true,
      // Fills the slot the refund needs.
      values: { amount: order.price },
      // What the system found, for Jev to read.
      note: `Look Up Order: order ${id}, ${order.item}, $${order.price}, ${order.status}.`,
    };
  }
  if (tool === "refund") {
    return {
      ok: true,
      note: `Refund: $${values.amount} refunded to the original payment method.`,
    };
  }
  // …
}
```

- **`values`** fill slots from your system, marked as coming from the system rather than the
  customer.
- **`note`** is what the tool found, in words. It goes into the conversation Jev reads, so
  "delivered 45 days ago" is what lets the policy pick "neither".
- **`say`** (not used here) is something to tell the customer about the result, said before the
  agent's next line.

A failed tool (`ok: false`) hands off.

The log is the whole state. Keep it (it's plain JSON) and the conversation can be resumed,
replayed or inspected from it alone; `view(log)` derives the intent, the values and where each
came from, the steps done and what the agent is waiting for.

## 7. What it says

Every line comes from a `Templates` object, and you'll want to change some. Pass your own over the
defaults:

```ts
import { defaultTemplates, type Templates } from "question-kit/service-agent";

const wording: Partial<Templates> = {
  done: () => "Thanks for shopping with us. Bye for now!",
  handoff: () => "Let me get a colleague to take this one; they'll be with you shortly.",
};

await turn(service, log, input, {
  client,
  templates: { ...defaultTemplates, ...wording },
});
```

Anything the company wants said at a fixed point in a procedure is a *say step*
(`{ say: "Refunds take 3 to 5 business days to show up." }`): said with the agent's next message,
without waiting for a reply, and in the conversation when Jev picks the next optional step.

## 8. Things you'll add when they come up

The store doesn't need these, but most services hit one of them:

- **A question the customer may ask at any point** (opening hours, the menu): an intent with
  `aside: true`, whose procedure only says things or calls tools that need no values. It's answered
  and the conversation carries on where it was.
- **Troubleshooting:** `{ try: ["log-out-in", "cookies"] }`, tools with an `instruction` for the
  customer, tried in turn with "did that fix it?" after each.
- **A step that needs one of several values** (`needs: [{ anyOf: ["name", "account_id"] }]`), a
  value fixed by the procedure (`{ tool: "notify", fixed: { team: "web" } }`), or a slot that
  means something different at one step (`roles`).
- **A note the procedure can do without** (`skipIfMissing: true`): a customer who can't give its
  values isn't handed off.
- **An order built up over several messages:** a *repeat* step with a `menu` slot, read by
  `question-kit/order`. That's the [pizza shop](../pizza-shop.md), and it's different enough to
  have its own walkthrough.

## 9. Tuning it: gates and the log

Every reading passes a gate before the agent acts on it, and the defaults are the ones the agent
ran with in our evals:

| Gate | Default |
| --- | --- |
| `intent` | 0.9 |
| `value` | 0.9 |
| `policy` | 0.9 |
| `confirm` | 0.8 |
| `repeat` | 0.7 |
| `yesNo` | 0.6 |

Lower gates act more and ask less; higher gates ask more and hand off more.
[How the agent decides](../how-the-agent-decides.md) says what happens on each side of each one.

Don't move them by feel. Pass a `recorder` and every gate decision is reported as it's made: which
reading, its confidence, the threshold, what the code did.

```ts
import { consoleRecorder } from "question-kit";

// The same as `bun run service:chat --gates`.
await turn(service, log, input, { client, recorder: consoleRecorder });
```

Run a few dozen conversations, look at where readings land relative to each gate, and move a gate
only when you can see what it would have changed. Pass `calls: []` too and every request is
collected there, so you can see what the service costs per turn (one to three requests, well under
a cent).

## 10. Testing without Jev

Two clients make the agent testable:

- **`cachedJev`** keeps every answer on disk. With `{ mode: "replay" }` it never calls the API and
  throws on a request it hasn't seen, which is how `bun run service:chat --replay` works and how a
  test on recorded conversations can run in CI for free.
- **`fakeJev(answer)`** answers from a function you write, for unit tests of your own procedure
  logic. The kit's own tests script Jev's answers per kind of question and check the actions that
  come out.

Also run `defineService` in a test. It's cheap, and it's where a renamed tool or a slot nobody
collects shows up.

## What it doesn't do yet

- replies written by a model;
- a customer changing topic mid-chat (a second request goes to a person);
- a value needed only in some cases (an address only for deliveries);
- learning the steps of a procedure from past chats.

The agent is an alpha that has been through our evals on recorded conversations but hasn't run on
live chats. The gates are there so that when it's unsure, it asks or hands off rather than
guesses.
