// Reading with Jev: what the customer wants, the values a step needs, their answers to the agent's
// questions, and which optional step (if any) the company's procedure calls for next.
//
// Each reading is gated in code: "act" when confident enough, "skip" when Jev is confident it isn't
// there, "unsure" otherwise. Values are read from the whole conversation, both sides, because the
// question the agent just asked is what makes a reply like "5843990922" an order ID (experiment 2:
// 98.6% of values right with the agent's lines, 93.2% without).

import {
  type ChoiceReading,
  type Classified,
  check,
  classify,
  extractDate,
  extractValue,
  type JevCall,
  type JevClient,
  type Json,
  type Label,
  noRecorder,
  type NoulReading,
  type Recorder,
  ref,
  run,
  runAll,
  type Task,
  type ValueKind,
} from "question-kit";
import { position } from "./decide.ts";
import { type AgentEvent, type ConfirmAnswer, customerText, key, type Outcome, transcript, type View } from "./log.ts";
import { needSlots, type Service, type SlotSpec } from "./service.ts";

export interface ReadOptions {
  jev: JevClient;
  /** Today's date (YYYY-MM-DD), for date slots. */
  today?: string;
  recorder?: Recorder;
  /** Every request made is pushed here (for cost and inspection). */
  calls?: JevCall[];
}

/** What to read before deciding: each thing at most once per customer message. */
export interface ReadPlan {
  intent: boolean;
  /** When the agent just asked which of a few intents the customer means: those intents. */
  clarify?: string[];
  slots: string[];
  /** What a slot means at the current step, when the step says. */
  roles?: Record<string, string>;
  /** A troubleshooting step waiting for "did that fix it?". */
  fixed?: number;
  /** A value the agent just checked with the customer. */
  value?: { slot: string; checked: string };
  /** A read-back waiting for an answer, and the values to read again if the customer corrects one. */
  confirm?: { step: number; clear: string[] };
  /** Optional steps for Jev to pick among. */
  policy?: { group: number; round: number; options: number[] };
  /** The reply to "anything else?": does the customer want more? */
  more?: boolean;
}

export function isEmpty(p: ReadPlan): boolean {
  return !p.intent && !p.slots.length && p.fixed === undefined && !p.value && !p.confirm && !p.policy && !p.more;
}

export function readPlan(s: Service, v: View): ReadPlan {
  const plan: ReadPlan = { intent: false, slots: [] };
  if (v.ended || v.customerTurns === 0) return plan;
  const fresh = (k: string) => v.readAt[k] !== v.customerTurns;
  if (!v.intent) {
    plan.intent = fresh(key.intent);
    if (plan.intent && v.pending?.type === "clarify") plan.clarify = v.pending.intents;
    return plan;
  }
  const p = v.pending;
  if (p?.type === "ask-fixed" && fresh(key.fixed(p.step))) plan.fixed = p.step;
  if (p?.type === "check-value" && fresh(key.value(p.slot))) plan.value = { slot: p.slot, checked: p.value };
  if (p?.type === "confirm" && fresh(key.confirm(p.step))) {
    const st = s.steps[v.intent]?.[p.step];
    const clear = (st?.needs ?? []).flatMap(needSlots).filter((sl) => v.slots[sl]?.from === "customer");
    plan.confirm = { step: p.step, clear };
  }
  const pos = position(s, v);
  if (pos.policy && !v.policy.has(key.policy(pos.policy.group, pos.policy.round))) {
    plan.policy = { group: pos.policy.group, round: pos.policy.round, options: pos.policy.options.map((x) => x.index) };
  }
  // The reply to "anything else?". Optional steps passed over are picked again with it in view: the
  // procedure's conditions often turn on the customer's reaction ("if they keep pushing, offer a
  // discount") or on something they say only then (the amount they were overcharged).
  if (p?.type === "wrap-up" && fresh(key.more)) {
    plan.more = true;
    const sk = pos.skipped[0];
    if (sk && !plan.policy) plan.policy = { group: sk.group, round: sk.round, options: sk.options.map((x) => x.index) };
  }
  for (const id of pos.missing) if (fresh(key.slot(id)) && !plan.slots.includes(id)) plan.slots.push(id);
  if (pos.step && Object.keys(pos.step.roles).length) plan.roles = pos.step.roles;
  return plan;
}

export const INTENT_QUESTION = "What does the customer want help with?";
export const CLARIFY_QUESTION = "The agent asked which of these the customer needs help with. Going by the customer's reply, which is it?";
export const INTENT_NONE = "The customer hasn't said yet what they need help with.";
export const POLICY_QUESTION =
  "The agent follows the company's `procedure` for the customer's `request` and has done the `steps_done`. Going by the procedure and the `chat` (including what the system found), which of these should the agent do or offer the customer next?";
export const POLICY_NONE = "None of these: at this point the procedure doesn't call for or allow any of them.";
export const CONFIRM_QUESTION = "The agent read back what it is about to do. How does the customer answer in their last message?";
export const CONFIRM_OPTIONS: Record<ConfirmAnswer, string> = {
  yes: "They agree to go ahead as read back.",
  correct: "They want it done, but say a detail of the read-back is wrong or give a different value.",
  no: "They don't want it done.",
};
export const FIXED_STATEMENT = "In their last message, the customer says the problem is fixed or that it works now.";
export const MORE_STATEMENT = "In their last message, the customer asks for something more, or says they still aren't satisfied.";

/** The intents as labels: name (and group), the company's description, and examples. */
export function intentLabels(s: Service): Record<string, Label> {
  return Object.fromEntries(
    Object.entries(s.intents).map(([id, x]) => {
      const label: Record<string, string | string[]> = { what: x.group ? `${x.name} (${x.group})` : x.name };
      if (x.description) label.description = x.description;
      if (x.examples?.length) label.examples = x.examples;
      return [id, label as unknown as Label];
    }),
  );
}

/** The role Jev reads a slot for: the step's own, the slot's, or "the customer's {label}"; with its format. */
export function roleOf(slot: SlotSpec, override?: string): string {
  const role = override ?? slot.role ?? `the customer's ${slot.label}`;
  return slot.format ? `${role} (${slot.format})` : role;
}

type SlotReading = { value: string | null; raw: string | null; confidence: number };

/** The task that reads one slot from the conversation. */
export function slotTask(slot: SlotSpec, chat: string, today?: string, roleOverride?: string): Task<SlotReading> {
  const role = roleOf(slot, roleOverride);
  if (slot.options) {
    const t = classify(ref("chat"), slot.options, { question: `Which of these is ${role}, going by what the customer has said?`, none: `The customer hasn't said ${role}.` });
    return { ...t, read: (a) => toSlot(t.read(a)) };
  }
  if (slot.date) {
    if (!today) throw new Error(`a date slot (${slot.label}) needs \`today\``);
    const t = extractDate(ref("chat"), { role, today, expect: slot.date });
    return { ...t, read: (a) => ((r) => ({ value: r.date, raw: r.date, confidence: r.confidence }))(t.read(a)) };
  }
  const kind: ValueKind = slot.list ? { names: slot.list } : slot.pattern!;
  const t = extractValue(ref("chat"), { source: chat, kind, role, ...(slot.normalize ? { normalize: slot.normalize } : {}) });
  return { ...t, read: (a) => ((r) => ({ value: r.value, raw: r.raw, confidence: r.confidence }))(t.read(a)) };
}

function toSlot(r: ChoiceReading): SlotReading {
  return r.value === "none" ? { value: null, raw: null, confidence: r.confidence } : { value: r.value, raw: r.value, confidence: r.confidence };
}

function outcome(value: unknown, confidence: number, gate: number): Outcome {
  if (confidence < gate) return "unsure";
  return value === null ? "skip" : "act";
}

/**
 * The steps the agent has done, in order, with their values: what Jev needs to know where the
 * procedure stands (the chat alone doesn't show them). Changes the customer turned down are listed too.
 */
export function stepsDone(s: Service, log: readonly AgentEvent[]): string {
  const name = (tool: string) => s.tools[tool]?.name ?? tool;
  const lines: string[] = [];
  let call: Extract<AgentEvent, { type: "call" }> | null = null;
  for (const e of log) {
    if (e.type === "call") call = e;
    else if (e.type === "result") {
      const values = call && call.step === e.step ? Object.entries(call.values).map(([k, v]) => `${s.slots[k]?.label ?? k}: ${v}`) : [];
      lines.push(`${name(e.tool)}${values.length ? ` (${values.join("; ")})` : ""}${e.ok ? "" : ": failed"}`);
      call = null;
    } else if (e.type === "agent" && e.action.type === "say") {
      lines.push(`Said: "${e.text}"`);
    } else if (e.type === "skip") {
      lines.push(`${name(e.tool)}: skipped (${e.reason})`);
    } else if (e.type === "read-confirm" && e.outcome === "act" && e.answer === "no") {
      const step = [...log].reverse().find((x): x is Extract<AgentEvent, { type: "agent" }> => x.type === "agent" && x.action.type === "confirm" && x.action.step === e.step);
      if (step?.action.type === "confirm") lines.push(`Offered ${name(step.action.tool)}: the customer turned it down`);
    }
  }
  return lines.length ? lines.map((l, i) => `${i + 1}. ${l}`).join("\n") : "none yet";
}

/** Read what the plan asks for. Intent goes alone (the rest depends on it); everything else in one request. */
export async function read(s: Service, log: readonly AgentEvent[], plan: ReadPlan, opts: ReadOptions): Promise<AgentEvent[]> {
  const rec = opts.recorder ?? noRecorder;
  const at = new Date().toISOString();
  const out: AgentEvent[] = [];
  if (plan.intent) {
    const labels = intentLabels(s);
    const readWith = async (task: Task<Classified<string>>) => {
      const r = await run(opts.jev, task, { log: opts.calls, title: "intent" });
      const value = r.value === "none" ? null : r.value;
      return { r, value, o: outcome(value, r.confidence, s.gates.intent) };
    };
    const full = () => classify(customerText(log), labels, { question: INTENT_QUESTION, none: INTENT_NONE, name: "customer" });
    // After "is this about X or Y?", the reply is read against just those, with the question in view.
    // If it's none of them ("No, it's about my bill"), everything the customer said is read again.
    let got = plan.clarify?.length
      ? await readWith(classify(transcript(log), Object.fromEntries(plan.clarify.map((id) => [id, labels[id]!])), { question: CLARIFY_QUESTION, none: "None of these.", name: "chat" }))
      : await readWith(full());
    if (plan.clarify?.length && got.o !== "act") got = await readWith(full());
    const { r, value, o } = got;
    rec.record({ method: "service-agent.intent", ...(value ? { task: value } : {}), confidence: r.confidence, threshold: s.gates.intent, decision: o, at });
    out.push({ type: "read-intent", value, confidence: r.confidence, outcome: o, ranked: r.ranked.slice(0, 5) });
    return out;
  }
  if (isEmpty(plan)) return out;

  const chat = transcript(log);
  const intent = [...log].reverse().find((e): e is Extract<AgentEvent, { type: "read-intent" }> => e.type === "read-intent" && e.outcome === "act")?.value ?? null;
  const steps = intent ? (s.steps[intent] ?? []) : [];
  const state: Record<string, Json> = { chat };
  const tasks: Record<string, Task<unknown>> = {};
  for (const id of plan.slots) tasks[`slot_${id}`] = slotTask(s.slots[id]!, chat, opts.today, plan.roles?.[id]);
  if (plan.fixed !== undefined) tasks[`fixed_${plan.fixed}`] = check(ref("chat"), FIXED_STATEMENT);
  if (plan.value) {
    const label = s.slots[plan.value.slot]!.label;
    tasks[`value_${plan.value.slot}`] = check(ref("chat"), `In their last message, the customer confirms that their ${label} is ${plan.value.checked}.`);
  }
  if (plan.confirm) tasks.confirm = classify(ref("chat"), CONFIRM_OPTIONS, { question: CONFIRM_QUESTION, none: false });
  if (plan.more) tasks.more = check(ref("chat"), MORE_STATEMENT);
  if (plan.policy) {
    // Options keyed by tool, so the ids say what they are.
    const labels: Record<string, Label> = {};
    for (const i of plan.policy.options) {
      const tool = s.tools[steps[i]!.tool]!;
      labels[steps[i]!.tool] = { what: `${tool.name ?? steps[i]!.tool}: ${tool.description}` };
    }
    const x = intent ? s.intents[intent]! : null;
    state.request = x?.name ?? "unknown";
    state.procedure = x?.procedure ?? x?.description ?? x?.name ?? "";
    state.steps_done = stepsDone(s, log);
    tasks.policy = classify(ref("chat"), labels, { question: POLICY_QUESTION, none: POLICY_NONE });
  }
  const answers = (await runAll(opts.jev, tasks, { state, log: opts.calls, title: "read" })) as Record<string, unknown>;

  for (const id of plan.slots) {
    const r = answers[`slot_${id}`] as SlotReading;
    const o = outcome(r.value, r.confidence, s.gates.value);
    rec.record({ method: "service-agent.slot", task: id, confidence: r.confidence, threshold: s.gates.value, decision: o, at });
    out.push({ type: "read-slot", slot: id, value: r.value, raw: r.raw, confidence: r.confidence, outcome: o });
  }
  if (plan.fixed !== undefined) {
    const r = answers[`fixed_${plan.fixed}`] as NoulReading;
    const o: Outcome = r.confidence >= s.gates.yesNo ? "act" : "unsure";
    rec.record({ method: "service-agent.fixed", task: String(plan.fixed), confidence: r.confidence, threshold: s.gates.yesNo, decision: o, at });
    out.push({ type: "read-yes-no", about: "fixed", step: plan.fixed, value: r.value, confidence: r.confidence, outcome: o });
  }
  if (plan.value) {
    const r = answers[`value_${plan.value.slot}`] as NoulReading;
    const o: Outcome = r.confidence >= s.gates.yesNo ? "act" : "unsure";
    rec.record({ method: "service-agent.check-value", task: plan.value.slot, confidence: r.confidence, threshold: s.gates.yesNo, decision: o, at });
    out.push({ type: "read-yes-no", about: "value", slot: plan.value.slot, checked: plan.value.checked, value: r.value, confidence: r.confidence, outcome: o });
  }
  if (plan.confirm) {
    const r = answers.confirm as Classified<ConfirmAnswer>;
    const o: Outcome = r.confidence >= s.gates.confirm ? "act" : "unsure";
    rec.record({ method: "service-agent.confirm", task: `${r.value} ${plan.confirm.step}`, confidence: r.confidence, threshold: s.gates.confirm, decision: o, at });
    out.push({ type: "read-confirm", step: plan.confirm.step, answer: r.value as ConfirmAnswer, confidence: r.confidence, outcome: o, clear: plan.confirm.clear });
  }
  if (plan.more) {
    const r = answers.more as NoulReading;
    const o: Outcome = r.confidence >= s.gates.yesNo ? "act" : "unsure";
    rec.record({ method: "service-agent.more", confidence: r.confidence, threshold: s.gates.yesNo, decision: o, at });
    out.push({ type: "read-yes-no", about: "more", value: r.value, confidence: r.confidence, outcome: o });
  }
  if (plan.policy) {
    const r = answers.policy as Classified<string>;
    const tool = r.value === "none" ? null : r.value;
    const step = tool === null ? null : (plan.policy.options.find((i) => steps[i]!.tool === tool) ?? null);
    const o = outcome(step, r.confidence, s.gates.policy);
    rec.record({ method: "service-agent.policy", task: tool ?? "none", confidence: r.confidence, threshold: s.gates.policy, decision: o, at });
    out.push({ type: "read-policy", group: plan.policy.group, round: plan.policy.round, value: step, confidence: r.confidence, outcome: o, ranked: r.ranked.slice(0, 5) });
  }
  return out;
}
