# How the agent decides

Every reading the agent asks Jev for comes back as a probability, and TypeSafe's
[confidence formulas](https://docs.typesafe.ai/confidence.md) turn that into a confidence between
0 and 1. The agent never acts on a reading directly; each one passes a *gate* first. This page is
about what happens on each side of the gate.

## Three outcomes

A gate turns a reading into one of three outcomes, recorded in the log with the reading:

- **act**: the confidence is at or above the gate, and the answer is something (an intent, a
  value, a pick). The agent acts on it.
- **skip**: the confidence is at or above the gate, and the answer is "none": Jev is sure the
  thing isn't there. The agent treats it as not given.
- **unsure**: the confidence is under the gate. What happens next depends on what was being read.

## The gates

| Reading | Gate | Default | When unsure |
| --- | --- | --- | --- |
| The intent | `intent` | 0.9 | Offer the likeliest few ("is this about a refund or an exchange?") and read the reply against just those; after repeated misses, hand off. |
| A value | `value` | 0.9 | If Jev's likeliest candidate is there, check it ("Just to check, is your order ID 6125190161?"); otherwise ask again, once; then try an alternative slot if the step allows one; then hand off. |
| Yes or no (did that fix it? is it X? finished?) | `yesNo` | 0.6 | Ask again, once; then hand off (or, for "anything else?", say goodbye). |
| The answer to a read-back | `confirm` | 0.8 | Ask again, once; then hand off. |
| Which optional step | `policy` | 0.9 | A change Jev leans toward is offered anyway (the read-back is the offer, so the customer decides); any other step isn't taken. |
| What a phrase calls for, in a repeat step | `repeat` | 0.7 | The pick isn't acted on; if nothing in the message was, the agent asks again. The gate is lower than `policy` because each call is read back by the app's reply and can be undone with the next message, so acting on a likely pick is the offer. |

The `yesNo` gate is on |2p − 1|, so 0.6 means p ≥ 0.8 or p ≤ 0.2.

These are the defaults the agent ran with in our evals; `defineService` takes a `gates` option
to change any of them. Lower gates act more and ask less; higher gates ask more and
hand off more. The log records every decision, so you can see where your service lands before
moving one.

## Read-backs

A tool marked `changes: true` is never called straight away. The agent reads the change back with
its values ("Just to confirm, I'll refund the order (amount: $42.00, method: store credit). Shall
I go ahead?") and reads the reply as one of three: go ahead, correct a detail, or don't. A
correction ("no, back to the card") makes the agent read the step's values again, with the
correction in view, and read the change back again, up to `corrections` times. A change the
customer turns down isn't made, and the procedure carries on without it.

In a repeat step the order is reversed, because the customer is building something up and sees
each change as it lands: the app's reply reads the change back after it's made, and the next
message can undo it. That's why repeat tools can't be `changes`, and why their gate is lower.

After the calls from a message, Jev checks what they made of the records: the records read back
next to the conversation, one Noul per record ("is this one wrong?") and one for "anything
missing?", phrased so that yes means wrong. If any answer gives P(wrong) at or above `readBackAt`
(0.3 by default, the edge of the uncertain band in TypeSafe's self-consistency cookbook), the agent
reads everything back and asks "Is that right?" before going on, and reads the reply as yes or a
correction. So a wrong pick that got past the gate still has to get past the check and the
customer.

One more thing happens before that gate. When an earlier phrase in the same message took a
record off ("scratch the sprites"), changing that record and adding are the same action ("make it
two lemonades"), so their probabilities are counted together before the pick is read. In our
recorded runs this turned a 0.65 / 0.34 split into one pick at 0.98.

## Where values come from

Values are read from the whole conversation, both sides, not just the last message. The question
the agent asked is what makes a bare "5843990922" an order ID, and in our evals reading with the
agent's lines in view was clearly better than reading the customer's lines alone.

A value is read at most once per customer message, and a value already known isn't asked for
again. A tool result can fill values from your system (`values: { amount: "42.00" }`), marked as
coming from the system rather than the customer.

## What Jev is told

For a judgment call among optional steps, Jev gets the company's written procedure for the request,
the steps done so far with their values (and any change the customer turned down), and the
conversation including what the tools found (each result's `note`). For what a phrase in an order
calls for, it gets the message, the order so far, and the phrase. Nothing is summarized or
rewritten by a model on the way; the state is the log, rendered as text.

## Seeing the decisions

Pass a `recorder` to `turn` and every gate decision is reported as it's made, with the reading's
confidence, the threshold and the outcome. `consoleRecorder` prints them; `memoryRecorder()`
collects them for tests; `jsonlRecorder(path)` from `question-kit/node` appends them to a file;
your own `{ record(event) }` can send them anywhere. The pizza shop's screen is built from the log
alone.
