// One turn: take a customer message (or a tool's result), read what's needed, decide what to do.
//
//   let log: AgentEvent[] = [];
//   let r = await turn(service, log, { type: "customer", text: "hi, I need a refund" }, { jev });
//   while (r.action.type === "call") {
//     const ok = await runTool(r.action.tool, r.action.values);         // the app runs tools
//     r = await turn(service, r.log, { type: "result", tool: r.action.tool, step: r.action.step, ok }, { jev });
//   }
//   say(r.action);                                                    // ask, confirm, hand off…
//
// The log is the whole state: keep it (as JSON) between messages.

import type { Json } from "question-kit";
import { decide } from "./decide.ts";
import { type Action, type AgentEvent, type View, view } from "./log.ts";
import { isEmpty, type ReadOptions, read, readPlan } from "./read.ts";
import type { Service } from "./service.ts";
import { defaultTemplates, type Templates } from "./templates.ts";

export type TurnInput =
  | { type: "customer"; text: string }
  /**
   * A tool's result. `values` fill slots the customer hasn't given (from the system: an order's item
   * and price); `note` is what it found, in words, for Jev to read ("The oracle says yes: …").
   */
  | { type: "result"; tool: string; step: number; ok: boolean; values?: Record<string, string>; note?: string; data?: Json };

export interface TurnOptions extends ReadOptions {
  templates?: Templates;
  /** Most read rounds in one turn (a round is usually one request). Default 6. */
  maxReads?: number;
}

export interface TurnResult {
  log: AgentEvent[];
  action: Action;
  view: View;
  /** Everything the agent says this turn, in order: say steps' text, then the action's. Show these. */
  messages: string[];
}

export async function turn(s: Service, log: readonly AgentEvent[], input: TurnInput, opts: TurnOptions): Promise<TurnResult> {
  const events: AgentEvent[] = [...log, input.type === "customer" ? { type: "customer", text: input.text } : { type: "result", tool: input.tool, step: input.step, ok: input.ok, ...(input.values ? { values: input.values } : {}), ...(input.note ? { note: input.note } : {}), ...(input.data !== undefined ? { data: input.data } : {}) }];
  let v = view(events);
  if (v.ended) throw new Error("the conversation has ended");
  const messages: string[] = [];
  let action: Action;
  // Say steps and steps passed over don't need anyone else, so the turn carries on past them.
  for (let steps = 0; ; steps++) {
    // Read until there's nothing new to read (normally one or two requests: the intent, then values).
    for (let i = 0; i < (opts.maxReads ?? 6); i++) {
      const plan = readPlan(s, v);
      if (isEmpty(plan)) break;
      events.push(...(await read(s, events, plan, opts)));
      v = view(events);
    }
    action = decide(s, v, opts.templates ?? defaultTemplates);
    if (steps > 50 || (action.type !== "say" && action.type !== "skip")) break;
    if (action.type === "say") {
      events.push({ type: "agent", text: action.text, action });
      messages.push(action.text);
    } else events.push({ type: "skip", step: action.step, tool: action.tool, reason: action.reason });
    v = view(events);
  }
  if (action.type === "call") events.push({ type: "call", tool: action.tool, step: action.step, values: action.values });
  else if (action.type !== "say" && action.type !== "skip") {
    events.push({ type: "agent", text: action.text, action });
    messages.push(action.text);
    if (action.type === "done" || action.type === "handoff") events.push({ type: "end", how: action.type, ...(action.type === "handoff" ? { reason: action.reason } : {}) });
  }
  return { log: events, action, view: view(events), messages };
}
