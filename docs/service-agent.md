# Building an agent

`question-kit/service-agent` runs a customer-service conversation from a description of the
service. You write down what customers come for, what to collect, the tools your system offers
and the steps for each request; the agent takes it from there, one turn at a time. Code runs the
procedure. Jev reads the customer: what they want, the values a step needs, their answers, and the
judgment calls the written procedure leaves open. Nothing is written by a language model; what
the agent says comes from templates and the company's own wording.

The agent has been through our internal evals: hundreds of recorded customer-service conversations
played back against a scripted customer, scored on whether it finished with the right changes and
made no wrong one. It's an alpha, and it hasn't run on live chats yet, but we think it's ready to
play with.

## A service is data

```ts
import { defineService } from "question-kit/service-agent";

const service = defineService({
  intents: {
    refund: { name: "Refund", description: "The customer wants money back for an order.", examples: ["I want a refund"] },
    hours: { name: "Opening hours", description: "The customer asks when the store is open.", aside: true },
  },
  slots: {
    order_id: { label: "order ID", pattern: /\b\d{10}\b/g, format: "10 digits" },
    email: { label: "email address", pattern: "email" },
    method: { label: "refund method", options: { card: "back to the card", credit: "store credit" } },
  },
  tools: {
    "look-up-order": { description: "look up the order", needs: ["order_id", "email"] },
    refund: { description: "refund the order", needs: ["method"], changes: true },
  },
  procedures: {
    refund: ["look-up-order", "refund"],
    hours: [{ say: "We're open 9 to 6, Monday to Saturday." }],
  },
});
```

`defineService` checks that the parts fit together (every procedure's tools exist, every tool's
slots exist, a change isn't marked skippable) and throws a list of problems if not.

**Intents** are what customers come for: a name, the company's description, a few examples, a
`notFor` to keep look-alikes apart ("ordering a drink: that's an order"), and optionally the
written procedure, conditions included ("If the item has shipped, refund part of the
fee; otherwise waive it"). Jev reads the procedure when it has to pick an optional step. An intent
marked `aside: true` is a question the customer may ask at any point (opening hours, the menu): it's
answered and the conversation carries on where it was, at the start (the agent then asks what they
need) or in the middle of another request. An aside's procedure can only say things and call tools
that need no values; every message is read for asides once the conversation is under way.

**Slots** are the values to collect. Each says how its value is found:

| Kind | How | Example |
| --- | --- | --- |
| `pattern` | Code finds candidates with a regular expression or a built-in pattern (`email`, `phone`, `amount`, `number`, `zip`); Jev picks the one that plays the role. Over-finding is fine. | an order ID |
| `list` | Candidates are known values (names, products). | a customer's name |
| `options` | A fixed set; Jev picks one from what the customer said. | a refund method |
| `date` | A calendar date, read by `extractDate`; `past` or `future` says which when no year is given. | when it was bought |
| `menu` | Items from a menu, read by `question-kit/order`. For a repeat step. | a pizza order |
| `from` | One of the records a tool reported (the lines of an order). | "the second one" |

A `role` ("the customer's order ID") and a `format` ("10 digits") are told to Jev with the slot;
an `ask` is how the agent asks for it.

**Tools** are what your system can do. Each lists the slots it `needs`. `changes: true` means it
changes something (an order, an account, money): the agent reads the change back and asks before
calling it. `skipIfMissing: true` marks a note the procedure can do without, so a customer who
can't give its values isn't handed off.

**Procedures** give each intent its steps, in order. A step is a tool name, or:

- `{ tool, needs, fixed, roles }`: the tool with different needs, values fixed by the procedure,
  or what a slot means at this step;
- `{ try: [...] }`: troubleshooting fixes tried in turn, asking after each whether it worked;
- `{ optional: [...] }`: steps the procedure calls for only sometimes; Jev picks which, if any, from
  the written procedure and the conversation;
- `{ say: "..." }`: something the agent says in the company's words, with its next message;
- `{ repeat: [...], ask, more }`: a step the customer drives for as long as they like (building up
  an order). After each message's calls, Jev checks what they made of the records against the
  conversation, and the agent reads them all back when something looks wrong. See
  [the pizza shop](pizza-shop.md).

## One turn

```ts
import { type AgentEvent, turn } from "question-kit/service-agent";

let log: AgentEvent[] = [];

async function onMessage(text: string) {
  let r = await turn(service, log, { type: "customer", text }, { client });
  while (r.action.type === "call") {
    const result = await runTool(r.action.tool, r.action.values); // your code
    r = await turn(service, r.log, { type: "result", tool: r.action.tool, step: r.action.step, ...result }, { client });
  }
  log = r.log;
  return r.messages; // what the agent says this turn
}
```

The agent never runs a tool itself. When the next step is a tool, `turn` returns a `call` action
with the tool's values; you run it and send back a result: `ok`, and optionally

- `values`, slots your system fills in (an order lookup gives the item and the price);
- `note`, what the system found in words, for Jev to read ("The order shipped on March 3");
- `records`, lists for `from` slots to pick among (the order's lines, each with an `id` and `text`);
- `say`, what to tell the customer about it ("Got it: 2 large pizzas.").

The other actions wait for the customer: `ask-intent`, `clarify` (which of these?), `ask` (for one
or more values), `check-value` ("is your order ID …?"), `confirm` (a change read back), `ask-fixed`
(did that fix it?), `repeat-ask` (anything else?), `repeat-check` (the records read back: is that
right?), `wrap-up`; and two end the chat: `done` and
`handoff`, with a reason.

### The log is the state

`turn` takes the log so far and returns a longer one: every message, every reading Jev made (with
its confidence and what the gate did), every call and result. It's plain JSON. Store it between
messages, and the conversation can be resumed, replayed or inspected from it alone; `view(log)`
derives the intent, the values collected and where each came from, the steps done and what the
agent is waiting for.

### What it says

Everything the agent says comes from a `Templates` object; pass your own in `opts.templates`, over
`defaultTemplates`, to change the wording. The pizza shop replaces three lines, for instance:

```ts
import { defaultTemplates, type Templates } from "question-kit/service-agent";

const wording: Partial<Templates> = {
  confirm: (_tool, values) => `Send it to the kitchen and text ${values.find((v) => v.label === "phone number")?.value} when it's ready?`,
  done: () => "Thanks! Grab a seat.",
  handoff: () => "Let me get someone to help you at the counter.",
};
await turn(service, log, input, { client, templates: { ...defaultTemplates, ...wording } });
```

### Watching it work

Pass `calls: []` in the options and every request to Jev is pushed there, with its answers and
timing (`estimateCost(calls)` from `question-kit` prices them). Pass a `recorder` and every gate
decision is reported: which reading, its confidence, the threshold, and what the code did.
[How the agent decides](how-the-agent-decides.md) explains the gates.

## Options

`defineService` also takes:

| Option | Default | What it does |
| --- | --- | --- |
| `gates` | `intent` 0.9, `value` 0.9, `policy` 0.9, `repeat` 0.7, `yesNo` 0.6, `confirm` 0.8 | Confidence needed to act on each kind of reading. |
| `retries` | 1 | How many times to ask again when unsure before trying an alternative or handing off. |
| `clarifyWith` | 3 | How many intents to offer when asking which one the customer means. |
| `corrections` | 2 | Corrections to a read-back before a handoff. |
| `offerWhenUnsure` | true | When Jev leans toward an optional change but is under the gate, offer it (the read-back is the offer) rather than skip it. |
| `wrapUps` | 3 | Most times to ask "anything else?"; 0 ends the chat as soon as the procedure is through. |
| `readBackAt` | 0.3 | In a repeat step, read the records back and ask when Jev's check gives any of them, or "anything missing?", P(wrong) at or above this. 1 turns the check off. |

## What it doesn't do yet

Replies written by a model; a customer changing topic mid-chat (a second request goes to a
person); a value needed only in some cases (an address only for deliveries); learning the steps of
a procedure from past chats.
