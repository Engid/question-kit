// Deciding the next action from the view: plain code. The procedure runs in order; Jev's readings
// (already in the log) say what's known, and Jev's picks decide the optional steps.

import { type Action, key, type View } from "./log.ts";
import { type NormalStep, needSlots, type Service } from "./service.ts";
import { defaultTemplates, type Templates } from "./templates.ts";

/** Where the procedure stands. */
export interface Position {
  /** The step to work on, or null when finished (or waiting on a pick among optional steps). */
  step: NormalStep | null;
  /** Slots that would meet the step's unmet needs (every alternative of each). */
  missing: string[];
  /** Values the step has so far: collected ones and the step's fixed ones. */
  values: Record<string, string>;
  /** Optional steps waiting for Jev to pick among them. */
  policy?: { group: number; round: number; options: NormalStep[] };
  /** Optional steps passed over (Jev picked none, or wasn't sure): picked again if the customer wants more. */
  skipped: { group: number; round: number; options: NormalStep[] }[];
}

const nowhere = (skipped: Position["skipped"] = []): Position => ({ step: null, missing: [], values: {}, skipped });

function stepPosition(st: NormalStep, v: View, skipped: Position["skipped"]): Position {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const n of st.needs) {
    const ids = needSlots(n);
    const fixed = ids.find((id) => id in st.fixed);
    const have = ids.find((id) => v.slots[id]);
    if (fixed) values[fixed] = st.fixed[fixed]!;
    else if (have) values[have] = v.slots[have]!.value;
    else missing.push(...ids);
  }
  for (const [k, x] of Object.entries(st.fixed)) values[k] ??= x;
  return { step: st, missing, values, skipped };
}

/** The step to work on now, skipping steps done, troubleshooting no longer needed, and optional steps not picked. */
export function position(s: Service, v: View): Position {
  if (!v.intent) return nowhere();
  const steps = s.steps[v.intent] ?? [];
  const skipped: Position["skipped"] = [];
  const fixedGroups = new Set(steps.filter((st) => st.group !== undefined && v.fixed.get(st.index) === true).map((st) => st.group));
  const settled = (st: NormalStep) => v.done.has(st.index) || v.confirmed.get(st.index) === false;
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i]!;
    if (st.optional !== undefined) {
      // Optional steps: Jev picks one at a time from those not yet done, or none.
      const members = steps.filter((x) => x.optional === st.optional);
      i = members.at(-1)!.index;
      const round = members.filter(settled).length;
      const options = members.filter((x) => !settled(x));
      if (!options.length) continue;
      const pick = v.policy.get(key.policy(st.optional, round));
      if (!pick) return { ...nowhere(skipped), policy: { group: st.optional, round, options } };
      // Jev's pick is taken when sure. When not, a change it leans toward is offered: the agent reads
      // it back and the customer decides (as with a value Jev isn't sure of).
      const top = pick.value !== null ? options.find((x) => x.index === pick.value) : undefined;
      const chosen = top && (pick.outcome === "act" || (pick.outcome === "unsure" && s.offerWhenUnsure && s.tools[top.tool]?.changes)) ? top : undefined;
      if (!chosen) {
        skipped.push({ group: st.optional, round, options });
        continue;
      }
      if (v.failed.has(chosen.index)) return { step: chosen, missing: [], values: {}, skipped };
      return stepPosition(chosen, v, skipped);
    }
    if (st.group !== undefined && fixedGroups.has(st.group)) continue;
    if (v.passed.has(st.index)) continue;
    // A change the customer turned down isn't made; the procedure carries on without it.
    if (v.confirmed.get(st.index) === false) continue;
    // A troubleshooting step isn't finished until the customer says whether it worked.
    if (v.done.has(st.index) && (st.group === undefined || v.fixed.has(st.index))) continue;
    return stepPosition(st, v, skipped);
  }
  return nowhere(skipped);
}

export function decide(s: Service, v: View, t: Templates = defaultTemplates): Action {
  const handoff = (reason: string): Action => ({ type: "handoff", reason, text: t.handoff(reason) });
  if (v.ended) return v.ended.how === "done" ? { type: "done", text: t.done() } : handoff(v.ended.reason ?? "ended");

  // 1. What does the customer want?
  if (!v.intent) {
    const misses = v.misses[key.intent] ?? 0;
    // One more try than for values: openings are often just "hi".
    if (misses > s.retries + 1) return handoff("the request isn't clear");
    const last = v.lastIntent;
    if (last?.outcome === "unsure") {
      const ids = last.ranked.map(([id]) => id).filter((id) => id in s.intents).slice(0, s.clarifyWith);
      if (ids.length >= 2) return { type: "clarify", intents: ids, text: t.clarify(ids.map((id) => s.intents[id]!)) };
    }
    const again = (v.asked[key.intent] ?? 0) > 0 && v.customerTurns > 0;
    return { type: "ask-intent", text: t.askIntent(again) };
  }

  // 2. Work through the procedure.
  const pos = position(s, v);
  if (pos.policy) return handoff("couldn't decide the next step");
  const st = pos.step;
  if (!st) {
    // Through the procedure: ask whether there's anything else, and end once the customer is
    // finished. If they want more, the optional steps passed over were picked again with their
    // reply in view (read.ts); anything still wanted goes to a person.
    if (v.more === false) return { type: "done", text: t.done() };
    if (v.more === true) return handoff("the customer wants something the procedure doesn't cover");
    if ((v.asked[key.more] ?? 0) >= s.wrapUps || (v.misses[key.more] ?? 0) > s.retries) return { type: "done", text: t.done() };
    const again = v.pending?.type === "wrap-up";
    return { type: "wrap-up", again, text: t.wrapUp(again) };
  }
  if (st.say !== undefined) return { type: "say", step: st.index, text: st.say };
  const tool = s.tools[st.tool]!;
  if (v.failed.has(st.index)) return handoff(`${st.tool} failed`);

  // A troubleshooting step that ran: did it fix things?
  if (v.done.has(st.index)) {
    if ((v.misses[key.fixed(st.index)] ?? 0) > s.retries) return handoff(`not sure whether ${st.tool} fixed it`);
    return { type: "ask-fixed", tool: st.tool, step: st.index, text: t.askFixed(tool) };
  }

  // Values the step still needs.
  const ask: string[] = [];
  for (const n of st.needs) {
    const ids = needSlots(n);
    if (ids.some((id) => id in pos.values)) continue;
    const open = ids.find((id) => (v.misses[key.slot(id)] ?? 0) <= s.retries);
    if (!open) {
      const reason = `couldn't get the ${ids.map((id) => s.slots[id]!.label).join(" or ")}`;
      // A note the procedure can do without: carry on. Anything else needs a person.
      if (tool.skipIfMissing) return { type: "skip", step: st.index, tool: st.tool, reason };
      return handoff(reason);
    }
    // Jev found a likely value but wasn't sure: check that one with the customer, once.
    const last = v.lastRead[open];
    if (last?.outcome === "unsure" && last.value !== null && !v.rejected[open]?.includes(last.value) && (v.asked[key.value(open)] ?? 0) <= (v.rejected[open]?.length ?? 0)) {
      return { type: "check-value", slot: open, value: last.value, tool: st.tool, text: t.checkValue(s.slots[open]!, last.value) };
    }
    if (!ask.includes(open)) ask.push(open);
  }
  // Ask for all of them in one question, as a person would ("Could I have your account ID and
  // order ID?"), so a reply giving several is read against a question that asked for them.
  if (ask.length) {
    const again = ask.some((id) => (v.misses[key.slot(id)] ?? 0) > 0);
    return { type: "ask", slot: ask[0]!, slots: ask, tool: st.tool, again, text: t.ask(ask.map((id) => s.slots[id]!), again) };
  }

  // Changes are read back first.
  if (tool.changes && v.confirmed.get(st.index) !== true) {
    if ((v.misses[key.confirm(st.index)] ?? 0) > s.retries) return handoff(`no clear answer to going ahead with ${st.tool}`);
    if ((v.corrections[st.index] ?? 0) > s.corrections) return handoff(`the details for ${st.tool} kept changing`);
    const shown = Object.entries(pos.values).map(([id, value]) => ({ label: s.slots[id]?.label ?? id, value }));
    return { type: "confirm", tool: st.tool, step: st.index, values: pos.values, text: t.confirm(tool, shown) };
  }
  return { type: "call", tool: st.tool, step: st.index, values: pos.values };
}
