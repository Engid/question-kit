// Reading with Jev: what the customer wants, the values a step needs, their answers to the agent's
// questions, and which optional step (if any) the company's procedure calls for next.
//
// Each reading is gated in code: "act" when confident enough, "skip" when Jev is confident it isn't
// there, "unsure" otherwise. Values are read from the whole conversation, both sides, because the
// question the agent just asked is what makes a reply like "5843990922" an order ID (experiment 2:
// 98.6% of values right with the agent's lines, 93.2% without).

import {
  type ChoiceReading,
  choiceConfidence,
  type Classified,
  check,
  classify,
  extractDate,
  extractValue,
  type SystemOneCall,
  type SystemOneClient,
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
} from "../core/index.ts";
import { takeOrder, tokenize } from "../order/index.ts";
import { position } from "./decide.ts";
import { type AgentEvent, type ConfirmAnswer, customerText, key, type Outcome, type Phrase, type Record_, transcript, type View } from "./log.ts";
import { type NormalStep, needSlots, type Service, type SlotSpec } from "./service.ts";

export interface ReadOptions {
  client: SystemOneClient;
  /** Today's date (YYYY-MM-DD), for date slots. */
  today?: string;
  recorder?: Recorder;
  /** Every request made is pushed here (for cost and inspection). */
  calls?: SystemOneCall[];
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
  /** A repeat step the customer is in: what each phrase of their message does, and whether they're finished. */
  repeat?: { group: number; tools: NormalStep[] };
  /** The agent read the records back: does the customer say they're right? (Read with `repeat`.) */
  right?: boolean;
  /** A message in a repeat step changed the records: check them against the conversation. */
  review?: { group: number; records: string };
  /** The service has asides (opening hours, the menu): is this message one of them? */
  aside?: boolean;
}

export function isEmpty(p: ReadPlan): boolean {
  return !p.intent && !p.slots.length && p.fixed === undefined && !p.value && !p.confirm && !p.policy && !p.more && !p.repeat && !p.review && !p.aside;
}

/** The aside intents, if any. */
export function asides(s: Service): string[] {
  return Object.keys(s.intents).filter((id) => s.intents[id]!.aside);
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
  // An aside being answered needs no reading; one just asked is read with the rest of the message.
  if (v.aside) return plan;
  if (asides(s).length && fresh(key.aside)) plan.aside = true;
  const p = v.pending;
  if (p?.type === "ask-fixed" && fresh(key.fixed(p.step))) plan.fixed = p.step;
  if (p?.type === "check-value" && fresh(key.value(p.slot))) plan.value = { slot: p.slot, checked: p.value };
  if (p?.type === "confirm" && fresh(key.confirm(p.step))) {
    const st = s.steps[v.intent]?.[p.step];
    const clear = (st?.needs ?? []).flatMap(needSlots).filter((sl) => v.slots[sl]?.from === "customer");
    plan.confirm = { step: p.step, clear };
  }
  const pos = position(s, v);
  if (pos.repeat && fresh(key.repeat(pos.repeat.group))) {
    plan.repeat = { group: pos.repeat.group, tools: pos.repeat.tools };
    if (p?.type === "repeat-check" && fresh(key.right(pos.repeat.group))) plan.right = true;
  }
  // The calls from this message are done: check what they made of the records, once per message.
  const rp = pos.repeat && v.repeat.get(pos.repeat.group);
  if (pos.repeat?.records && rp && !rp.queue.length && rp.calledAt === v.customerTurns && fresh(key.review(pos.repeat.group)) && s.readBackAt < 1) {
    plan.review = { group: pos.repeat.group, records: pos.repeat.records };
  }
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
export const ASIDE_QUESTION = "Does the customer's last message ask one of these, rather than going on with what they were doing?";
export const ASIDE_NONE = "None of these: the message goes on with the customer's request (an answer, an order, a change, a detail).";
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
export const REPEAT_QUESTION = "The customer is placing an order: `order` is what's on it so far, and `message` is what they just said. What does this part of the message call for?";
export const REPEAT_NONE = "Nothing on the order: it doesn't add, change or remove anything (a question about the menu, the hours or the place, say, or small talk).";
export const FINISHED_STATEMENT = "The customer says they have finished ordering: that's all, nothing else.";
export const RIGHT_STATEMENT = "The agent read the order back and asked whether it's right. In their last message, the customer says it is (yes, that's right), rather than pointing out a mistake or changing something.";
export const REVIEW_QUESTION = (what: string) => `\`order\` is what the agent has on the customer's order, line by line, after the \`chat\` so far. Is ${what} wrong: not something the customer asked for, or a size, number, kind or detail different from what they said (taking their changes into account)?`;
export const REVIEW_MISSING = "`order` is what the agent has on the customer's order, line by line, after the `chat` so far. Did the customer ask for something, or a change, that `order` leaves out?";
export const MORE_STATEMENT = "In their last message, the customer asks for something more, or says they still aren't satisfied.";

/** The intents as labels: name (and group), the company's description, and examples. */
export function intentLabels(s: Service): Record<string, Label> {
  return Object.fromEntries(
    Object.entries(s.intents).map(([id, x]) => {
      const label: Record<string, string | string[]> = { what: x.group ? `${x.name} (${x.group})` : x.name };
      if (x.description) label.description = x.description;
      if (x.notFor) label.not_for = x.notFor;
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
export function slotTask(slot: SlotSpec, chat: string, today?: string, roleOverride?: string, records: Record_[] = []): Task<SlotReading> {
  const role = roleOf(slot, roleOverride);
  if (slot.options) {
    const t = classify(ref("chat"), slot.options, { question: `Which of these is ${role}, going by what the customer has said?`, none: `The customer hasn't said ${role}.` });
    return { ...t, read: (a) => toSlot(t.read(a)) };
  }
  if (slot.from) {
    const options = Object.fromEntries(records.map((r) => [r.id, r.text]));
    const t = classify(ref("chat"), options, { question: `Which of these is ${role}, going by what the customer has said?`, none: `The customer hasn't said which.` });
    return { ...t, read: (a) => toSlot(t.read(a)) };
  }
  if (slot.menu) throw new Error(`a menu slot (${slot.label}) can only be used by a repeat step's tools`);
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
      const r = await run(opts.client, task, { log: opts.calls, title: "intent" });
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
    // An aside (opening hours) asked before saying what they need: answered, then asked again.
    if (o === "act" && value && s.intents[value]?.aside) out.push({ type: "read-aside", value, confidence: r.confidence, outcome: o });
    else out.push({ type: "read-intent", value, confidence: r.confidence, outcome: o, ranked: r.ranked.slice(0, 5) });
    return out;
  }
  if (plan.repeat) out.push(...(await readRepeat(s, log, plan.repeat, opts, plan.right ?? false, plan.aside ?? false)));
  if (plan.review) out.push(...(await readReview(s, log, plan.review, opts)));
  if (isEmpty({ ...plan, repeat: undefined, review: undefined, aside: plan.repeat ? undefined : plan.aside })) return out;

  const chat = transcript(log);
  const intent = [...log].reverse().find((e): e is Extract<AgentEvent, { type: "read-intent" }> => e.type === "read-intent" && e.outcome === "act")?.value ?? null;
  const steps = intent ? (s.steps[intent] ?? []) : [];
  const state: Record<string, Json> = { chat };
  const tasks: Record<string, Task<unknown>> = {};
  const records = [...log].reduce<Record<string, Record_[]>>((acc, e) => (e.type === "result" && e.records ? { ...acc, ...e.records } : acc), {});
  for (const id of plan.slots) tasks[`slot_${id}`] = slotTask(s.slots[id]!, chat, opts.today, plan.roles?.[id], records[s.slots[id]!.from ?? ""] ?? []);
  if (plan.fixed !== undefined) tasks[`fixed_${plan.fixed}`] = check(ref("chat"), FIXED_STATEMENT);
  if (plan.value) {
    const label = s.slots[plan.value.slot]!.label;
    tasks[`value_${plan.value.slot}`] = check(ref("chat"), `In their last message, the customer confirms that their ${label} is ${plan.value.checked}.`);
  }
  if (plan.confirm) tasks.confirm = classify(ref("chat"), CONFIRM_OPTIONS, { question: CONFIRM_QUESTION, none: false });
  if (plan.more) tasks.more = check(ref("chat"), MORE_STATEMENT);
  if (plan.aside) tasks.aside = classify(ref("chat"), Object.fromEntries(asides(s).map((id) => [id, intentLabels(s)[id]!])), { question: ASIDE_QUESTION, none: ASIDE_NONE });
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
  const answers = (await runAll(opts.client, tasks, { state, log: opts.calls, title: "read" })) as Record<string, unknown>;

  if (plan.aside) out.push(asideEvent(s, answers.aside as Classified<string>, rec, at));
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

/** The answer to "is this message an aside?", gated like an intent. */
function asideEvent(s: Service, a: Classified<string>, rec: Recorder, at: string): AgentEvent {
  const value = a.value === "none" ? null : a.value;
  const o = outcome(value, a.confidence, s.gates.intent);
  rec.record({ method: "service-agent.aside", ...(value ? { task: value } : {}), confidence: a.confidence, threshold: s.gates.intent, decision: o, at });
  return { type: "read-aside", value, confidence: a.confidence, outcome: o };
}

/**
 * A message in a repeat step. The menu slot's kit reads the items (one request), and the phrases
 * are the stretches of the message ending in each item. Then, in one request: for each phrase,
 * which of the step's tools it calls for (a tool that needs a record gets one option per record:
 * "change line 2"), and whether the customer says they're finished. A message naming no items is
 * one phrase, offered only the tools that need no items.
 */
export async function readRepeat(s: Service, log: readonly AgentEvent[], plan: NonNullable<ReadPlan["repeat"]>, opts: ReadOptions, right = false, aside = false): Promise<AgentEvent[]> {
  const rec = opts.recorder ?? noRecorder;
  const at = new Date().toISOString();
  const message = [...log].reverse().find((e): e is Extract<AgentEvent, { type: "customer" }> => e.type === "customer")?.text ?? "";
  const slotOf = (st: NormalStep, kind: "menu" | "from") => st.needs.flatMap(needSlots).find((id) => s.slots[id]?.[kind]);
  const menuSlot = plan.tools.map((st) => slotOf(st, "menu")).find((id) => id);
  const menu = menuSlot ? s.slots[menuSlot]!.menu! : undefined;
  const records: Record<string, Record_[]> = {};
  for (const e of log) if (e.type === "result" && e.records) Object.assign(records, e.records);

  // The phrases: each item's words and the words before them ("take off the coke"), back to the
  // previous item's last word that means something.
  const phrases: { text: string; items?: Json; readBack?: string[] }[] = [];
  if (menu) {
    const r = await takeOrder(message, menu, opts.client, { check: false, partial: true });
    opts.calls?.push(...r.calls);
    const words = tokenize(message);
    let from = 1;
    r.spans.forEach(([first, last], k) => {
      let end = last;
      while (end > first && r.words[end - 1]!.tag === "none") end--;
      phrases.push({ text: words.slice(from - 1, end).join(" "), items: [r.items[k]] as unknown as Json, readBack: [r.readBack[k]!] });
      from = end + 1;
    });
  }
  if (!phrases.length) phrases.push({ text: message });

  // Each phrase's options: the step's tools, times the records for a tool that needs one.
  const options = phrases.map((p) => {
    const out: Record<string, Label> = {};
    for (const st of plan.tools) {
      const tool = s.tools[st.tool]!;
      const from = slotOf(st, "from");
      if (slotOf(st, "menu") && p.items === undefined) continue;
      const what = tool.name ?? st.tool;
      if (!from) out[st.tool] = { what, description: tool.description } as unknown as Label;
      else for (const r of records[s.slots[from]!.from!] ?? []) out[`${st.tool}@${r.id}`] = { what: `${what}: ${r.text}`, description: `${tool.description}: ${r.text}` } as unknown as Label;
    }
    return out;
  });
  const lines = Object.values(records).flat();
  const state: Record<string, Json> = {
    message,
    order: lines.length ? Object.fromEntries(lines.map((r) => [r.id, r.text])) : "nothing yet",
    phrases: Object.fromEntries(phrases.map((p, k) => [`p${k + 1}`, p.text])),
  };
  const tasks: Record<string, Task<unknown>> = { finished: check(ref("message"), FINISHED_STATEMENT) };
  if (right) tasks.right = check(ref("message"), RIGHT_STATEMENT);
  if (aside) tasks.aside = classify(ref("message"), Object.fromEntries(asides(s).map((id) => [id, intentLabels(s)[id]!])), { question: ASIDE_QUESTION, none: ASIDE_NONE });
  phrases.forEach((_, k) => {
    if (Object.keys(options[k]!).length) tasks[`p${k + 1}`] = classify(ref(`phrases.p${k + 1}`), options[k]!, { question: REPEAT_QUESTION, none: REPEAT_NONE });
  });
  const answers = (await runAll(opts.client, tasks, { state, log: opts.calls, title: "repeat" })) as Record<string, unknown>;

  const out: AgentEvent[] = [];
  if (aside) out.push(asideEvent(s, answers.aside as Classified<string>, rec, at));
  const fin = answers.finished as NoulReading;
  const finO: Outcome = fin.confidence >= s.gates.yesNo ? "act" : "unsure";
  rec.record({ method: "service-agent.finished", confidence: fin.confidence, threshold: s.gates.yesNo, decision: finO, at });
  out.push({ type: "read-yes-no", about: "finished", group: plan.group, value: fin.value, confidence: fin.confidence, outcome: finO });
  if (right) {
    const r = answers.right as NoulReading;
    const o: Outcome = r.confidence >= s.gates.yesNo ? "act" : "unsure";
    rec.record({ method: "service-agent.right", confidence: r.confidence, threshold: s.gates.yesNo, decision: o, at });
    out.push({ type: "read-yes-no", about: "right", group: plan.group, value: r.value, confidence: r.confidence, outcome: o });
  }
  // The tool that adds (needs the menu slot, no record), for merging below.
  const adder = plan.tools.find((st) => slotOf(st, "menu") && !slotOf(st, "from"))?.tool;
  const removed = new Set<string>();
  const read: Phrase[] = [];
  phrases.forEach((p, k) => {
    const a = answers[`p${k + 1}`] as Classified<string> | undefined;
    if (!a) {
      read.push({ text: p.text, tool: null, confidence: 1, outcome: "skip" });
      return;
    }
    // Once an earlier phrase took a record off ("scratch the sprites"), changing that record and
    // adding are the same thing ("make it two lemonades"): their probabilities count together.
    const merged: Record<string, number> = {};
    for (const [id, pr] of Object.entries(a.probabilities)) {
      const [tool, record] = id.split("@") as [string, string | undefined];
      const key = adder && record !== undefined && removed.has(record) && p.items !== undefined && slotOf(plan.tools.find((st) => st.tool === tool)!, "menu") ? adder : id;
      merged[key] = (merged[key] ?? 0) + pr;
    }
    const [value, probability] = Object.entries(merged).sort((x, y) => y[1] - x[1])[0]!;
    const confidence = Object.keys(merged).length === Object.keys(a.probabilities).length ? a.confidence : choiceConfidence(Object.values(merged));
    void probability;
    const [tool, record] = value === "none" ? [null, undefined] : (value.split("@") as [string, string | undefined]);
    const o = outcome(tool, confidence, s.gates.repeat);
    rec.record({ method: "service-agent.repeat", task: value, confidence, threshold: s.gates.repeat, decision: o, at });
    if (o === "act" && tool && record !== undefined && !slotOf(plan.tools.find((st) => st.tool === tool)!, "menu")) removed.add(record);
    read.push({ text: p.text, tool, ...(record !== undefined ? { record } : {}), ...(p.items !== undefined ? { items: p.items, readBack: p.readBack! } : {}), confidence, outcome: o });
  });
  out.push({ type: "read-repeat", group: plan.group, phrases: read });
  return out;
}

/**
 * After a message's calls changed the records: the records read back next to the conversation, one
 * Noul per record ("is this line wrong?") and one for "anything missing?", phrased so that yes means
 * wrong, as in TypeSafe's verification cascade. The agent reads the records back to the customer
 * when any answer gives P(wrong) at or above `readBackAt`.
 */
export async function readReview(s: Service, log: readonly AgentEvent[], plan: NonNullable<ReadPlan["review"]>, opts: ReadOptions): Promise<AgentEvent[]> {
  const rec = opts.recorder ?? noRecorder;
  const at = new Date().toISOString();
  const records: Record_[] = [];
  for (const e of log) if (e.type === "result" && e.records?.[plan.records]) records.splice(0, records.length, ...e.records[plan.records]!);
  const state: Record<string, Json> = { chat: transcript(log), order: records.length ? Object.fromEntries(records.map((r, k) => [`i${k + 1}`, r.text])) : "nothing" };
  const tasks: Record<string, Task<unknown>> = { missing: check(ref("order"), REVIEW_MISSING) };
  records.forEach((_, k) => {
    tasks[`i${k + 1}`] = check(ref(`order.i${k + 1}`), REVIEW_QUESTION(`\`order.i${k + 1}\``));
  });
  const answers = (await runAll(opts.client, tasks, { state, log: opts.calls, title: "check" })) as Record<string, NoulReading>;
  const wrong = records.map((r, k) => ({ id: r.id, text: r.text, p: answers[`i${k + 1}`]!.probability }));
  const missing = answers.missing!.probability;
  const doubt = wrong.some((w) => w.p >= s.readBackAt) || missing >= s.readBackAt;
  rec.record({ method: "service-agent.review", confidence: 1 - Math.max(missing, ...wrong.map((w) => w.p)), threshold: 1 - s.readBackAt, decision: doubt ? "unsure" : "act", at });
  return [{ type: "read-review", group: plan.group, wrong, missing, doubt }];
}
