// The conversation's state is an append-only log of what happened. Everything else (the intent,
// the values collected, the steps done, what the agent is waiting for) is derived from it by `view`.
// A chat can be stored, resumed, replayed and inspected from the log alone.

import type { Json } from "../core/index.ts";

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
  /** Say a say step's text (with the next message; turn handles it). `aside`: the step belongs to an aside intent. */
  | { type: "say"; step: number; text: string; aside?: string }
  /** An aside's steps are all done: the conversation carries on where it was (turn handles it). */
  | { type: "aside-done"; intent: string }
  /** Carry on without a step whose values the customer couldn't give (turn handles it). */
  | { type: "skip"; step: number; tool: string; reason: string }
  /** Run a tool: the app does it and sends back the result. `aside`: the step belongs to an aside intent. */
  | { type: "call"; tool: string; step: number; values: Record<string, Json>; aside?: string }
  /** Read back a change before making it. */
  | { type: "confirm"; tool: string; step: number; values: Record<string, Json>; text: string }
  /** In a repeat step: ask what the customer wants (`first`), or whether they want anything else. */
  | { type: "repeat-ask"; group: number; first: boolean; again: boolean; text: string }
  /** In a repeat step, after Jev's check doubted the records: read them all back and ask whether they're right. */
  | { type: "repeat-check"; group: number; lines: string[]; text: string }
  /** After a troubleshooting step: did it fix things? */
  | { type: "ask-fixed"; tool: string; step: number; text: string }
  /** The procedure is through: "Is there anything else I can help you with?", and wait for the reply. */
  | { type: "wrap-up"; again: boolean; text: string }
  /** Pass the chat to a person. */
  | { type: "handoff"; reason: string; text: string }
  /** The customer needs nothing more: say goodbye and end. */
  | { type: "done"; text: string };

/** Actions that wait for the customer's reply. */
export type Waiting = Extract<Action, { type: "ask-intent" | "clarify" | "ask" | "check-value" | "confirm" | "ask-fixed" | "wrap-up" | "repeat-ask" | "repeat-check" }>;

/** A record a tool reported (a line of an order), for `from` slots to pick among. */
export interface Record_ {
  id: string;
  text: string;
}

/** What one phrase of the customer's message does, in a repeat step: which tool, on which record, with which items. */
export interface Phrase {
  text: string;
  /** The tool it calls for, or null for none. */
  tool: string | null;
  /** The record it's about (a `from` slot's value), when the tool needs one. */
  record?: string;
  /** The items it names (a menu slot's value), when the tool needs them. */
  items?: Json;
  /** The items as read back to the customer. */
  readBack?: string[];
  confidence: number;
  outcome: Outcome;
}

/** The customer's answer to a read-back: go ahead, change a detail, or don't. */
export type ConfirmAnswer = "yes" | "correct" | "no";

export type AgentEvent =
  | { type: "customer"; text: string }
  /** What the agent said, and the action it came from. */
  | { type: "agent"; text: string; action: Action }
  | { type: "read-intent"; value: string | null; confidence: number; outcome: Outcome; ranked: [string, number][] }
  /** The customer asked an aside (opening hours, the menu), at the start or in the middle of a request. */
  | { type: "read-aside"; value: string | null; confidence: number; outcome: Outcome }
  /** An aside's steps are through. */
  | { type: "aside"; intent: string; done: true }
  | { type: "read-slot"; slot: string; value: string | null; raw: string | null; confidence: number; outcome: Outcome }
  /** "Did that fix it?" after a troubleshooting step, or "is your … X?" after checking a value. */
  | { type: "read-yes-no"; about: "fixed"; step: number; value: boolean; confidence: number; outcome: Outcome }
  | { type: "read-yes-no"; about: "value"; slot: string; checked: string; value: boolean; confidence: number; outcome: Outcome }
  /** After "anything else?": does the customer want more (true) or are they finished (false)? */
  | { type: "read-yes-no"; about: "more"; value: boolean; confidence: number; outcome: Outcome }
  /** In a repeat step: has the customer said they're finished? */
  | { type: "read-yes-no"; about: "finished"; group: number; value: boolean; confidence: number; outcome: Outcome }
  /** In a repeat step, after the records were read back: does the customer say they're right? */
  | { type: "read-yes-no"; about: "right"; group: number; value: boolean; confidence: number; outcome: Outcome }
  /** In a repeat step, after a message changed the records: Jev's check of each one (P(wrong)) and of anything missing. */
  | { type: "read-review"; group: number; wrong: { id: string; text: string; p: number }[]; missing: number; doubt: boolean }
  /** In a repeat step: what each phrase of the customer's message does. */
  | { type: "read-repeat"; group: number; phrases: Phrase[] }
  /** The answer to a read-back. On a correction, `clear` lists the values to read again. */
  | { type: "read-confirm"; step: number; answer: ConfirmAnswer; confidence: number; outcome: Outcome; clear: string[] }
  /** Jev's pick among optional steps (`value` is a step index, or null for none of them). */
  | { type: "read-policy"; group: number; round: number; value: number | null; confidence: number; outcome: Outcome; ranked: [string, number][] }
  | { type: "call"; tool: string; step: number; values: Record<string, Json>; aside?: string }
  /**
   * A tool's result. `values` fill slots from the system (an order lookup gives the item and price);
   * `note` is what the system found, put in the conversation Jev reads ("the oracle says yes");
   * `records` are what it reports for `from` slots (the order's lines, by name); `say` is what
   * the agent tells the customer about it.
   */
  | { type: "result"; tool: string; step: number; ok: boolean; values?: Record<string, string>; note?: string; data?: Json; records?: Record<string, Record_[]>; say?: string; aside?: string }
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
  /** An aside the customer just asked, being answered: its intent and the steps done. */
  aside: { intent: string; done: Set<number> } | null;
  /** The customer turn an aside was last read on (that turn's other reads don't count as misses). */
  asideAt: number | null;
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
  /** The latest records each tool reported, by name (the order's lines). */
  records: Record<string, Record_[]>;
  /**
   * Each repeat group: the calls still to make from the last message, how many were made (and on
   * which customer turn the last one was), Jev's latest check of the records and the turn it was
   * made on, the turn the customer last said the read-back was right, and whether they're finished.
   */
  repeat: Map<number, { queue: Phrase[]; calls: number; calledAt: number | null; review: { at: number; doubt: boolean } | null; rightAt: number | null; wrongAt: number | null; finished: boolean }>;
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
  aside: "aside",
  repeat: (group: number) => `repeat:${group}`,
  review: (group: number) => `review:${group}`,
  right: (group: number) => `right:${group}`,
};

/** Fold the log into the current view. */
export function view(log: readonly AgentEvent[]): View {
  const v: View = {
    intent: null,
    aside: null,
    asideAt: null,
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
    records: {},
    repeat: new Map(),
    pending: null,
    misses: {},
    asked: {},
    customerTurns: 0,
    readAt: {},
    ended: null,
    lastIntent: null,
  };
  // A message that asked an aside isn't a miss for whatever else was being read.
  const miss = (k: string) => (v.asideAt === v.customerTurns ? v.misses[k] : (v.misses[k] = (v.misses[k] ?? 0) + 1));
  const ask = (k: string) => (v.asked[k] = (v.asked[k] ?? 0) + 1);
  // An "ask" is answered once everything it asked for is known.
  const settleAsk = () => {
    if (v.pending?.type === "ask" && v.pending.slots.every((sl) => v.slots[sl])) v.pending = null;
  };
  const rep = (group: number) => {
    let r = v.repeat.get(group);
    if (!r) v.repeat.set(group, (r = { queue: [], calls: 0, calledAt: null, review: null, rightAt: null, wrongAt: null, finished: false }));
    return r;
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
        if (a.type === "say") (a.aside ? v.aside?.done : v.done)?.add(a.step);
        if (a.type === "wrap-up") ask(key.more);
        // An answer to "anything else?" stands until the agent acts on it.
        else v.more = null;
        if (a.type === "repeat-ask") ask(key.repeat(a.group));
        if (a.type === "repeat-check") ask(key.right(a.group));
        v.pending = a.type === "ask-intent" || a.type === "clarify" || a.type === "ask" || a.type === "check-value" || a.type === "confirm" || a.type === "ask-fixed" || a.type === "wrap-up" || a.type === "repeat-ask" || a.type === "repeat-check" ? a : null;
        break;
      }
      case "read-aside":
        v.readAt[key.aside] = v.customerTurns;
        // At the start, the aside was read in place of the intent.
        if (!v.intent) v.readAt[key.intent] = v.customerTurns;
        if (e.outcome === "act" && e.value) {
          v.aside = { intent: e.value, done: new Set() };
          v.asideAt = v.customerTurns;
        }
        break;
      case "aside":
        v.aside = null;
        break;
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
        } else if (e.about === "finished") {
          if (e.outcome === "act" && e.value) {
            rep(e.group).finished = true;
            v.pending = null;
          }
        } else if (e.about === "right") {
          v.readAt[key.right(e.group)] = v.customerTurns;
          if (e.outcome === "act") {
            if (e.value) rep(e.group).rightAt = v.customerTurns;
            else rep(e.group).wrongAt = v.customerTurns;
            v.pending = null;
          } else miss(key.right(e.group));
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
      case "read-repeat": {
        v.readAt[key.repeat(e.group)] = v.customerTurns;
        const r = rep(e.group);
        r.queue = e.phrases.filter((p) => p.outcome === "act" && p.tool !== null);
        if (r.queue.length) v.pending = null;
        // Nothing to do, and the customer neither finished nor answered the read-back (both read just before): not understood.
        else if (!r.finished && r.rightAt !== v.customerTurns && r.wrongAt !== v.customerTurns) miss(key.repeat(e.group));
        break;
      }
      case "read-review": {
        v.readAt[key.review(e.group)] = v.customerTurns;
        rep(e.group).review = { at: v.customerTurns, doubt: e.doubt };
        break;
      }
      case "call": {
        v.pending = null;
        v.more = null;
        const g = [...v.repeat.entries()].find(([, r]) => r.queue[0]?.tool === e.tool);
        if (g) {
          g[1].queue.shift();
          g[1].calls++;
          g[1].calledAt = v.customerTurns;
        }
        break;
      }
      case "result":
        if (e.aside) {
          v.aside?.done.add(e.step);
          break;
        }
        (e.ok ? v.done : v.failed).add(e.step);
        for (const [slot, value] of Object.entries(e.values ?? {})) v.slots[slot] ??= { value, confidence: 1, at, from: "system" };
        for (const [name, records] of Object.entries(e.records ?? {})) v.records[name] = records;
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
    .flatMap((e) => (e.type === "customer" ? [`customer: ${e.text}`] : e.type === "agent" ? [`agent: ${e.text}`] : e.type === "result" ? [...(e.note ? [`system: ${e.note}`] : []), ...(e.say ? [`agent: ${e.say}`] : [])] : []))
    .join("\n");
}

/** Only what the customer said, one message per line, leaving out messages that were asides (answered already). */
export function customerText(log: readonly AgentEvent[]): string {
  const lines: string[] = [];
  log.forEach((e, i) => {
    if (e.type !== "customer") return;
    const next = log.slice(i + 1).find((x) => x.type === "customer" || (x.type === "read-aside" && x.outcome === "act" && x.value));
    if (next?.type !== "read-aside") lines.push(e.text);
  });
  return lines.join("\n");
}
