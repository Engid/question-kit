# @question-kit/service-agent

A lightweight customer-service agent on Jev. Code runs the company's procedure; Jev reads the
customer (what they want, the values each step needs, their answers) and makes the procedure's
judgment calls (which optional step, if any, the company's written procedure calls for, given what
the tools found). There's no LLM: what the agent says comes from templates, and every decision Jev
informs passes a confidence gate first.

It's a prototype, measured in our research repo (not public) on ABCD's customer-service chats (Chen et al.,
2021): on 200 held-out chats, against a scripted customer built from each recorded chat, it finished
77.5% with the right changes and made no wrong change; the same agent with simple rules in place of
Jev finished 47.0%. It isn't published yet; in this repo it's a workspace package.

## Try it

[`examples/service-agent`](../../examples/service-agent/README.md) is a made-up store's support chat
you can talk to in the terminal: `bun run service:chat` (needs `TYPESAFE_API_KEY` in `.env`).

## A service is data

```ts
import { defineService } from "@question-kit/service-agent";

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

- **Intents:** a name, the company's description, a few examples, and optionally its written
  `procedure`, conditions included ("If the oracle says yes, remove the fee").
- **Slots:** what to collect. Code finds the candidates (a pattern, a list of known values) and Jev
  picks; or Jev picks one of fixed options; or it's a date. A `format` ("10 digits") is told to Jev
  with the slot, which helps with bare values.
- **Tools:** what each needs. `changes: true` means the agent reads the change back and asks before
  calling it. `skipIfMissing: true` marks a note the procedure can do without (recording a reason):
  if the customer can't give its values, the agent carries on instead of handing off. A change can't
  be skipped.
- **Procedures:** each intent's steps in order. A step can need any one of several slots
  (`{ anyOf: ["name", "account_id"] }`), fix values (`{ tool, fixed: { team: "web" } }`), say what
  a value means at that step (`roles: { method: "the new payment method the customer wants" }`),
  be a set of troubleshooting fixes tried in turn until one works (`{ try: ["log-out-in", "cookies"] }`),
  be a set of optional steps for Jev to choose from (`{ optional: ["refund", "waive-fee"] }`), or be
  something the agent says in the company's words (`{ say: "Our prices change with demand." }`),
  sent with its next message.

## One turn

```ts
import { turn, type AgentEvent } from "@question-kit/service-agent";

let log: AgentEvent[] = [];
let r = await turn(service, log, { type: "customer", text: "hi, I need a refund for 1234567890" }, { jev });
while (r.action.type === "call") {
  const ok = await runTool(r.action.tool, r.action.values); // your code
  // `note`: what the tool found, in words, for Jev to read ("The oracle says yes: the fee was our mistake").
  r = await turn(service, r.log, { type: "result", tool: r.action.tool, step: r.action.step, ok, note }, { jev });
}
log = r.log; // store it; it's plain JSON
show(r.messages); // what the agent says this turn: any say steps, then the action's text
// r.action: ask-intent | clarify | ask | check-value | confirm | ask-fixed | wrap-up | handoff | done
```

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
6. **Anything else?** Through the procedure, the agent asks and waits. Jev reads the reply: finished
   (goodbye), or wants more. Optional steps passed over are picked again with the reply in view,
   since a procedure's conditions often turn on the customer's reaction ("if they keep pushing,
   offer a discount") or on something they say only then (how much they were overcharged).
   Something more that no step covers goes to a person; a reply that isn't clear gets one more ask,
   then a goodbye (at most `wrapUps` asks, default 3).

Each turn makes one to three requests. Gate decisions go to an optional `recorder` (question-kit's
`Recorder`: a no-op by default, `consoleRecorder`, `jsonlRecorder`, `memoryRecorder`).

## API

| Export | What it is |
| --- | --- |
| `defineService(spec)` | Checks a service description (intents, slots, tools, procedures; options below) and returns the `Service` the rest takes. Throws on anything that doesn't fit together. |
| `turn(service, log, input, opts)` | One turn: `input` is the customer's message or a tool's result; `opts` has `jev`, and optionally `today` (for date slots), `recorder`, `calls` (every request, for cost), `templates`. Returns `{ log, action, view, messages }`. |
| `view(log)` | The state derived from the log: intent, values (and where each came from), steps done, what the agent is waiting for, misses. |
| `transcript(log)` | The conversation as Jev reads it: `customer:`, `agent:` and `system:` (tool notes) lines. |
| `defaultTemplates`, `Templates` | Everything the agent says; pass your own in `opts.templates`. |
| `readPlan`, `read`, `decide`, `position` | The pieces `turn` is made of, for building your own loop. |
| `AgentEvent`, `Action`, `View`, `ServiceSpec`, `Step`, … | The types. The log is plain JSON: store it as is. |

Service options: `gates` (`intent`, `value`, `policy` 0.9; `yesNo` 0.6; `confirm` 0.8), `retries`
(asks again before trying an alternative or handing off, 1), `clarifyWith` (intents offered when
unsure, 3), `corrections` (to a read-back before a handoff, 2), `offerWhenUnsure` (true),
`wrapUps` (3).

## Not in this draft

Replies written by a model; several requests in one message; a customer changing topic mid-chat
(a second request goes to a person); learning the order of steps from past chats (the research repo
learns the ABCD procedures that way, outside the package).
