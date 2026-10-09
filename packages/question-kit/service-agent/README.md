# question-kit/service-agent

A lightweight customer-service agent on Jev. Code runs the company's procedure; Jev reads the
customer (what they want, the values each step needs, their answers) and makes the procedure's
judgment calls (which optional step, if any, the company's written procedure calls for, given what
the tools found). There's no LLM: what the agent says comes from templates, and every decision Jev
informs passes a confidence gate first.

It's a prototype, measured in our research repo (not public) on ABCD's customer-service chats (Chen et al.,
2021): on 200 held-out chats, against a scripted customer built from each recorded chat, it finished
77.5% with the right changes and made no wrong change; the same agent with simple rules in place of
Jev finished 47.0%.

```sh
npm install question-kit @typesafe-ai/sdk
```

> **Alpha.** question-kit is a prototype, and its APIs will change between 0.x releases. Please try
> it and tell us what breaks or feels awkward: [open an issue](https://github.com/Engid/question-kit/issues).
> We're not taking pull requests yet; if you'd like to contribute, open an issue first so we can
> talk it over.

## Try it

- [The pizza shop](../../../examples/pizza-shop/README.md): order at a counter over a few messages,
  changing your mind as you go, with Jev's reads shown beside the chat. `bun run pizza` in the
  terminal, `bun run pizza:web` as a page (both need `TYPESAFE_API_KEY` in `.env`; `--fake` shows the
  screen without one).
- [The store](../../../examples/service-agent/README.md): a made-up outdoor store's support chat,
  `bun run service:chat`.

## A service is data

```ts
import { defineService } from "question-kit/service-agent";

const service = defineService({
  intents: {
    refund: { name: "Refund", description: "The customer wants money back for an order.", examples: ["I want a refund"] },
  },
  slots: {
    name: { label: "full name", list: ["Bart Simpson", "Homer Simpson"] },
    order_id: { label: "order ID", pattern: /\b\d{10}\b/g },
    amount: { label: "refund amount", pattern: "amount" },
    method: { label: "refund method", options: { card: "back to the card", credit: "store credit" } },
  },
  tools: {
    "pull-up": { description: "pull up the account", needs: ["name"] },
    validate: { description: "check the order", needs: ["order_id"] },
    refund: { description: "refund the order", needs: ["amount", "method"], changes: true },
  },
  procedures: { refund: ["pull-up", "validate", "refund"] },
});
```

- **Intents:** a name, the company's description, a few examples, a `notFor` to keep look-alikes
  apart, and optionally its written `procedure`, conditions included ("If the oracle says yes, remove the fee"). `aside: true` marks
  a question the customer may ask at any point (opening hours): answered, then the conversation
  carries on where it was.
- **Slots:** what to collect. Code finds the candidates (a pattern, a list of known values) and Jev
  picks; or Jev picks one of fixed options; or it's a date. A `format` ("10 digits") is told to Jev
  with the slot, which helps with bare values. Two more kinds serve repeat steps (below): `menu`,
  items from a menu read by `question-kit/order`, and `from: "order"`, one of the records a tool
  reported (the lines of an order).
- **Tools:** what each needs. `changes: true` means the agent reads the change back and asks before
  calling it. `skipIfMissing: true` marks a note the procedure can do without (recording a reason):
  if the customer can't give its values, the agent carries on instead of handing off. A change can't
  be skipped.
- **Procedures:** each intent's steps in order. A step can need any one of several slots
  (`{ anyOf: ["name", "account_id"] }`), fix values (`{ tool, fixed: { team: "web" } }`), say what
  a value means at that step (`roles: { method: "the new payment method the customer wants" }`),
  be a set of troubleshooting fixes tried in turn until one works (`{ try: ["log-out-in", "cookies"] }`),
  be a set of optional steps for Jev to choose from (`{ optional: ["refund", "waive-fee"] }`), be
  something the agent says in the company's words (`{ say: "Our prices change with demand." }`),
  sent with its next message, or be a *repeat*: a step the customer drives for as long as they
  like, such as building up an order (`{ repeat: ["add-items", "change-item", "remove-item"], ask:
  "What can I get for you?" }`). In a repeat, each customer message is split into phrases and Jev
  picks what each one calls for: which of the step's tools, on which of the records the app
  reported ("change line 2"), or nothing; and whether the customer says they're done.

## One turn

```ts
import { turn, type AgentEvent } from "question-kit/service-agent";

let log: AgentEvent[] = [];
let r = await turn(service, log, { type: "customer", text: "hi, I need a refund for 1234567890" }, { client });
while (r.action.type === "call") {
  const ok = await runTool(r.action.tool, r.action.values); // your code
  // `note`: what the tool found, in words, for Jev to read ("The oracle says yes: the fee was our mistake").
  // `records`: lines for `from` slots to pick among ({ order: [{ id: "1", text: "2 large pizzas" }] }).
  // `say`: what to tell the customer about it, said before the agent's next line ("Got it: 2 large pizzas.").
  r = await turn(service, r.log, { type: "result", tool: r.action.tool, step: r.action.step, ok, note }, { client });
}
log = r.log; // store it; it's plain JSON
show(r.messages); // what the agent says this turn: a result's `say`, any say steps, then the action's text
// r.action: ask-intent | clarify | ask | check-value | confirm | ask-fixed | repeat-ask | repeat-check | wrap-up | handoff | done
```

A call's `values` are text for ordinary slots, and JSON for a menu slot (the items, as
`question-kit/order` reads them).

The log is the whole state: every message, every reading (with its confidence and what the gate
did), every tool call and result. `view(log)` derives the intent, the values, the steps done and what
the agent is waiting for.

What a turn does:

1. **Intent**, while unknown: one `classify` over the intents, with "none" for an opening that
   doesn't say yet. At 0.9 or above it's set; below, the agent offers the likeliest few ("is this
   about X or Y?") and reads the reply against those, or against all of them if it names another;
   after repeated misses it hands off.
2. **Values** the current step still needs, read from the whole conversation (both sides: the
   question the agent just asked is what makes a bare number an order ID). Values given earlier
   aren't asked for again. At 0.9 or above a value is kept. Under it, if Jev's likeliest candidate
   is there, the agent checks it ("Just to check, is your order ID 6125190161?"); otherwise it asks
   for everything the step still needs in one question, asks once more, tries an alternative slot
   if there is one, then hands off.
3. **Answers**: "did that fix it?" and "is your … X?" as Nouls; the answer to a read-back as one of
   go ahead, correct a detail, or don't. A correction ("No, it should be store credit") makes the
   agent read the step's values again with the correction in view, and read the change back again.
   A change the customer turns down isn't made, and the procedure carries on.
4. **Optional steps**: Jev reads the company's procedure, the steps the agent has done (with their
   values, and any change the customer turned down), the conversation and what the tools found,
   and picks which optional step to do or offer next, or none. At 0.9 or above it's taken. Under
   it, a change Jev leans toward is offered: it's read back, so the customer decides, as with a
   value Jev isn't sure of (`offerWhenUnsure: false` skips it instead); any other step isn't taken.
   A change is always read back before it's made. After one is done or turned down, Jev picks again
   from the rest.
5. **Next action**, in code: the first step not done; ask for what's missing, check a doubtful
   value, confirm a change, or call the tool. A say step is said and the turn carries on; so does a
   `skipIfMissing` note the customer couldn't give values for.
6. **A repeat step**: `question-kit/order` reads the message's items (one request), and the
   phrases are the stretches of the message ending in each item ("and take off the coke"). Then
   one request asks, for each phrase, which of the step's tools it calls for: a tool that needs a
   `from` slot gets one option per record the app last reported ("Change: 1 diet coke"), a tool
   that needs the menu slot is offered only for phrases that name items, and "none" is always
   there; plus a Noul, "the customer says they've finished ordering." Each pick at the `repeat`
   gate (0.7: the app's reply reads each call back) or above becomes a call, in order; a message with nothing to do and no "finished" counts as
   a miss (asked again, then a handoff). Repeat tools can't be `changes`: each one is read back
   after, by the app's `say`, and a call that fails isn't a handoff either (the `say` explains, and
   the agent asks again). After the calls, one more request checks the records the app reported
   against the conversation (a Noul per record, "is this one wrong?", and "anything missing?"); at
   P(wrong) of `readBackAt` (0.3) or more, the agent reads them all back ("So that's …. Is that
   right?") and reads the reply as yes or a correction.
7. **Anything else?** Through the procedure, the agent asks and waits. Jev reads the reply: finished
   (goodbye), or wants more. Optional steps passed over are picked again with the reply in view,
   since a procedure's conditions often turn on the customer's reaction ("if they keep pushing,
   offer a discount") or on something they say only then (how much they were overcharged).
   Something more that no step covers goes to a person; a reply that isn't clear gets one more ask,
   then a goodbye (at most `wrapUps` asks, default 3).

Each turn makes one to three requests. Gate decisions go to an optional `recorder` (question-kit's
`Recorder`: a no-op by default, `consoleRecorder`, `memoryRecorder`, or `jsonlRecorder` from `question-kit/node`).

## API

| Export | What it is |
| --- | --- |
| `defineService(spec)` | Checks a service description (intents, slots, tools, procedures; options below) and returns the `Service` the rest takes. Throws on anything that doesn't fit together. |
| `turn(service, log, input, opts)` | One turn: `input` is the customer's message or a tool's result (`ok`, and optionally `values`, `note`, `records`, `say`, `data`); `opts` has `client`, and optionally `today` (for date slots), `recorder`, `calls` (every request, for cost), `templates`. Returns `{ log, action, view, messages }`. |
| `view(log)` | The state derived from the log: intent, values (and where each came from), steps done, what the agent is waiting for, misses. |
| `transcript(log)` | The conversation as Jev reads it: `customer:`, `agent:` (including results' `say`) and `system:` (tool notes) lines. |
| `defaultTemplates`, `Templates` | Everything the agent says; pass your own in `opts.templates`. |
| `readPlan`, `read`, `decide`, `position` | The pieces `turn` is made of, for building your own loop. |
| `AgentEvent`, `Action`, `View`, `ServiceSpec`, `Step`, … | The types. The log is plain JSON: store it as is. |

Service options: `gates` (`intent`, `value`, `policy` 0.9; `repeat` 0.7; `yesNo` 0.6; `confirm` 0.8), `retries`
(asks again before trying an alternative or handing off, 1), `clarifyWith` (intents offered when
unsure, 3), `corrections` (to a read-back before a handoff, 2), `offerWhenUnsure` (true),
`wrapUps` (3), `readBackAt` (0.3).

## Not in this draft

Replies written by a model; a customer changing topic mid-chat (a second request goes to a person);
a value needed only in some cases (an address only for deliveries); learning the order of steps from
past chats (the research repo learns the ABCD procedures that way, outside the package).
