// The conversation's state is an append-only log of what happened. Everything else (the intent,
// the values collected, the steps done, what the agent is waiting for) is derived from it by `view`.
// A chat can be stored, resumed, replayed and inspected from the log alone.

import type { Json } from "question-kit";

/** What code did with an answer: acted on it, wasn't sure, or (for "none") took it as not given. */
export type Outcome = "act" | "unsure" | "skip";

export type Action =
  /** Ask what the customer needs. */
  | { type: "ask-intent"; text: string }
  /** Ask which of a few intents the customer means. */
  | { type: "clarify"; intents: string[]; text: string }
  /** Ask for one or more values (`slot` is the first of `slots`) for a step's `tool`. */
  | { type: "ask"; slot: string; slots: string[]; tool: string; again: boolean; text: string }
  /** Check a value Jev wasn't sure of: "Just to check, is your order ID 6125190161?" */
  | { type: "check-value"; slot: string; value: string; tool: string; text: string }
  /** Say a say step's text (with the next message; turn handles it). */
  | { type: "say"; step: number; text: string }
  /** Carry on without a step whose values the customer couldn't give (turn handles it). */
  | { type: "skip"; step: number; tool: string; reason: string }
  /** Run a tool: the app does it and sends back the result. */
  | { type: "call"; tool: string; step: number; values: Record<string, string> }
  /** Read back a change before making it. */
  | { type: "confirm"; tool: string; step: number; values: Record<string, string>; text: string }
  /** After a troubleshooting step: did it fix things? */
  | { type: "ask-fixed"; tool: string; step: number; text: string }
  /** The procedure is through: "Is there anything else I can help you with?", and wait for the reply. */
  | { type: "wrap-up"; again: boolean; text: string }
  /** Pass the chat to a person. */
  | { type: "handoff"; reason: string; text: string }
  /** The customer needs nothing more: say goodbye and end. */
  | { type: "done"; text: string };

/** Actions that wait for the customer's reply. */
export type Waiting = Extract<Action, { type: "ask-intent" | "clarify" | "ask" | "check-value" | "confirm" | "ask-fixed" | "wrap-up" }>;

/** The customer's answer to a read-back: go ahead, change a detail, or don't. */
export type ConfirmAnswer = "yes" | "correct" | "no";

export type AgentEvent =
  | { type: "customer"; text: string }
  /** What the agent said, and the action it came from. */
  | { type: "agent"; text: string; action: Action }
  | { type: "read-intent"; value: string | null; confidence: number; outcome: Outcome; ranked: [string, number][] }
  | { type: "read-slot"; slot: string; value: string | null; raw: string | null; confidence: number; outcome: Outcome }
  /** "Did that fix it?" after a troubleshooting step, or "is your … X?" after checking a value. */
  | { type: "read-yes-no"; about: "fixed"; step: number; value: boolean; confidence: number; outcome: Outcome }
  | { type: "read-yes-no"; about: "value"; slot: string; checked: string; value: boolean; confidence: number; outcome: Outcome }
  /** After "anything else?": does the customer want more (true) or are they finished (false)? */
  | { type: "read-yes-no"; about: "more"; value: boolean; confidence: number; outcome: Outcome }
  /** The answer to a read-back. On a correction, `clear` lists the values to read again. */
  | { type: "read-confirm"; step: number; answer: ConfirmAnswer; confidence: number; outcome: Outcome; clear: string[] }
  /** Jev's pick among optional steps (`value` is a step index, or null for none of them). */
  | { type: "read-policy"; group: number; round: number; value: number | null; confidence: number; outcome: Outcome; ranked: [string, number][] }
  | { type: "call"; tool: string; step: number; values: Record<string, string> }
  /**
   * A tool's result. `values` fill slots from the system (an order lookup gives the item and price);
   * `note` is what the system found, put in the conversation Jev reads ("the oracle says yes").
   */
  | { type: "result"; tool: string; step: number; ok: boolean; values?: Record<string, string>; note?: string; data?: Json }
  /** A step passed over: the customer couldn't give its values, and the tool can do without them. */
  | { type: "skip"; step: number; tool: string; reason: string }
  | { type: "end"; how: "done" | "handoff"; reason?: string };

export interface SlotValue {
  value: string;
  confidence: number;
  /** Index of the event that set it. */
  at: number;
  /** Where it came from: the customer's words (read by Jev, or confirmed by them), or a tool. */
  from: "customer" | "system";
}

export interface View {
  intent: string | null;
  slots: Record<string, SlotValue>;
  /** The latest reading of each slot, settled or not (for checking a value Jev wasn't sure of). */
  lastRead: Record<string, { value: string | null; outcome: Outcome; confidence: number }>;
  /** Values already checked with the customer and turned down, by slot. */
  rejected: Record<string, string[]>;
  /** Steps whose tool ran and succeeded, and say steps said. */
  done: Set<number>;
  /** Steps passed over because the customer couldn't give their values. */
  passed: Set<number>;
  /** Steps whose tool failed. */
  failed: Set<number>;
  /** Troubleshooting steps after which the customer said it was fixed or not. */
  fixed: Map<number, boolean>;
  /** Changes the customer agreed to (true) or turned down (false). */
  confirmed: Map<number, boolean>;
  /** Corrections to each step's read-back. */
  corrections: Record<number, number>;
  /** Jev's picks among optional steps, by "group:round" (a later pick for the same round replaces it). */
  policy: Map<string, { value: number | null; outcome: Outcome }>;
  /** The answer to the last "anything else?", until the agent does something else: wants more, finished, or not known. */
  more: boolean | null;
  /** The last thing the agent asked, if it's still waiting for an answer. */
  pending: Waiting | null;
  /** Reads that didn't settle, by key ("intent", "slot:order_id", "confirm:3", "fixed:3"). */
  misses: Record<string, number>;
  /** Times each thing was asked, by the same keys. */
  asked: Record<string, number>;
  /** Number of customer messages so far. */
  customerTurns: number;
  /** The customer message each key was last read at, so each is read once per message. */
  readAt: Record<string, number>;
  ended: { how: "done" | "handoff"; reason?: string } | null;
  /** The latest intent reading, for offering the likeliest intents when unsure. */
  lastIntent: Extract<AgentEvent, { type: "read-intent" }> | null;
}

export const key = {
  intent: "intent",
  slot: (s: string) => `slot:${s}`,
  confirm: (step: number) => `confirm:${step}`,
  fixed: (step: number) => `fixed:${step}`,
  value: (s: string) => `value:${s}`,
  more: "more",
  policy: (group: number, round: number) => `${group}:${round}`,
};

/** Fold the log into the current view. */
export function view(log: readonly AgentEvent[]): View {
  const v: View = {
    intent: null,
    slots: {},
    lastRead: {},
    rejected: {},
    done: new Set(),
    passed: new Set(),
    failed: new Set(),
    fixed: new Map(),
    confirmed: new Map(),
    corrections: {},
    policy: new Map(),
    more: null,
    pending: null,
    misses: {},
    asked: {},
    customerTurns: 0,
    readAt: {},
    ended: null,
    lastIntent: null,
  };
  const miss = (k: string) => (v.misses[k] = (v.misses[k] ?? 0) + 1);
  const ask = (k: string) => (v.asked[k] = (v.asked[k] ?? 0) + 1);
  // An "ask" is answered once everything it asked for is known.
  const settleAsk = () => {
    if (v.pending?.type === "ask" && v.pending.slots.every((sl) => v.slots[sl])) v.pending = null;
  };
  log.forEach((e, at) => {
    switch (e.type) {
      case "customer":
        v.customerTurns++;
        break;
      case "agent": {
        const a = e.action;
        if (a.type === "ask-intent" || a.type === "clarify") ask(key.intent);
        if (a.type === "ask") for (const sl of a.slots) ask(key.slot(sl));
        if (a.type === "check-value") ask(key.value(a.slot));
        if (a.type === "confirm") ask(key.confirm(a.step));
        if (a.type === "ask-fixed") ask(key.fixed(a.step));
        if (a.type === "say") v.done.add(a.step);
        if (a.type === "wrap-up") ask(key.more);
        // An answer to "anything else?" stands until the agent acts on it.
        else v.more = null;
        v.pending = a.type === "ask-intent" || a.type === "clarify" || a.type === "ask" || a.type === "check-value" || a.type === "confirm" || a.type === "ask-fixed" || a.type === "wrap-up" ? a : null;
        break;
      }
      case "read-intent":
        v.readAt[key.intent] = v.customerTurns;
        v.lastIntent = e;
        if (e.outcome === "act" && e.value) {
          v.intent = e.value;
          if (v.pending?.type === "ask-intent" || v.pending?.type === "clarify") v.pending = null;
        } else miss(key.intent);
        break;
      case "read-slot":
        v.readAt[key.slot(e.slot)] = v.customerTurns;
        v.lastRead[e.slot] = { value: e.value, outcome: e.outcome, confidence: e.confidence };
        if (e.outcome === "act" && e.value !== null && !v.rejected[e.slot]?.includes(e.value)) {
          v.slots[e.slot] = { value: e.value, confidence: e.confidence, at, from: "customer" };
        } else if (v.pending?.type === "ask" && v.pending.slots.includes(e.slot)) miss(key.slot(e.slot));
        settleAsk();
        break;
      case "read-yes-no":
        if (e.about === "more") {
          v.readAt[key.more] = v.customerTurns;
          if (e.outcome === "act") {
            v.more = e.value;
            v.pending = null;
          } else miss(key.more);
        } else if (e.about === "fixed") {
          v.readAt[key.fixed(e.step)] = v.customerTurns;
          if (e.outcome === "act") {
            v.fixed.set(e.step, e.value);
            v.pending = null;
          } else miss(key.fixed(e.step));
        } else {
          v.readAt[key.value(e.slot)] = v.customerTurns;
          if (e.outcome === "act") {
            if (e.value) v.slots[e.slot] = { value: e.checked, confidence: e.confidence, at, from: "customer" };
            else {
              (v.rejected[e.slot] ??= []).push(e.checked);
              miss(key.slot(e.slot));
            }
            v.pending = null;
          } else miss(key.slot(e.slot));
        }
        break;
      case "read-confirm":
        v.readAt[key.confirm(e.step)] = v.customerTurns;
        if (e.outcome !== "act") {
          miss(key.confirm(e.step));
          break;
        }
        v.pending = null;
        if (e.answer === "yes") v.confirmed.set(e.step, true);
        else if (e.answer === "no") v.confirmed.set(e.step, false);
        else {
          // A correction: forget the values the customer gave for this step, and read them again.
          v.corrections[e.step] = (v.corrections[e.step] ?? 0) + 1;
          for (const sl of e.clear) {
            delete v.slots[sl];
            delete v.readAt[key.slot(sl)];
          }
        }
        break;
      case "read-policy":
        v.policy.set(key.policy(e.group, e.round), { value: e.value, outcome: e.outcome });
        break;
      case "call":
        v.pending = null;
        v.more = null;
        break;
      case "result":
        (e.ok ? v.done : v.failed).add(e.step);
        for (const [slot, value] of Object.entries(e.values ?? {})) v.slots[slot] ??= { value, confidence: 1, at, from: "system" };
        break;
      case "skip":
        v.passed.add(e.step);
        break;
      case "end":
        v.ended = { how: e.how, ...(e.reason ? { reason: e.reason } : {}) };
        break;
    }
  });
  return v;
}

/** The conversation as text, one line per message, with what the system found: what Jev reads. */
export function transcript(log: readonly AgentEvent[]): string {
  return log
    .flatMap((e) => (e.type === "customer" ? [`customer: ${e.text}`] : e.type === "agent" ? [`agent: ${e.text}`] : e.type === "result" && e.note ? [`system: ${e.note}`] : []))
    .join("\n");
}

/** Only what the customer said, one message per line. */
export function customerText(log: readonly AgentEvent[]): string {
  return log
    .flatMap((e) => (e.type === "customer" ? [e.text] : []))
    .join("\n");
}
