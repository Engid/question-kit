// screen: check a message against a set of flags, and decide what to do.
//
// One request: one Noul per flag (phrased so that yes means the flag applies) and, optionally, a
// severity Score. Each flag names an action; code applies thresholds you set (a named policy) and a
// precedence among actions. Jev gives the evidence; your code makes the decision.
// Use it for guardrails on inputs and outputs, or for customer-service flags ("asks for a person",
// "wants to cancel").
// Based on the approach in TypeSafe's "Guardrails for LLMs" cookbook.

import type { Entry } from "../system-one.ts";
import { noul, score } from "../questions.ts";
import { readNoul, readScore } from "../readings.ts";
import { q, type Text } from "../state.ts";
import { place, type Task } from "../task.ts";

export interface Flag<A extends string> {
  /** A statement that's true when the flag applies: "The customer asks to speak to a person." */
  statement: string;
  true?: Entry;
  false?: Entry;
  /** What to do when it applies. */
  action: A;
}

export interface Policy {
  /** Take a flag's action at or above this probability. */
  act: number;
  /** Below `act` but at or above this, the action is "review". */
  review: number;
  /** With a severity Score, turn "review" into the most serious action at or above this level. */
  escalateAtSeverity?: number;
}

export interface ScreenOptions<A extends string> {
  /** Actions from most to least serious; the most serious triggered one wins. "review" and "pass" are added at the end. */
  precedence: A[];
  policy?: Policy;
  /** Optional severity question and its levels, lowest first. */
  severity?: { question: string; levels: Entry[] };
  name?: string;
}

export interface Screened<A extends string> {
  action: A | "review" | "pass";
  /** Flags at or above the review threshold, most likely first. */
  triggered: { flag: string; probability: number; action: A | "review" }[];
  /** Every flag's probability. */
  flags: Record<string, number>;
  severity?: number;
}

export const POLICIES = {
  strict: { act: 0.7, review: 0.35 },
  permissive: { act: 0.85, review: 0.35 },
} satisfies Record<string, Policy>;

export function screen<A extends string>(text: Text, flags: Record<string, Flag<A>>, opts: ScreenOptions<A>): Task<Screened<A>> {
  const t = place(text, opts.name ?? "message");
  const policy: Policy = opts.policy ?? POLICIES.strict;
  return {
    parts: t.parts,
    questions: (at) => {
      const r = t.ref(at);
      const qs: Record<string, ReturnType<typeof noul> | ReturnType<typeof score>> = {};
      for (const [id, f] of Object.entries(flags)) qs[id] = noul(q`About ${r}: ${f.statement}`, f.true || f.false ? { true: f.true, false: f.false } : undefined);
      if (opts.severity) qs.__severity = score(q`About ${r}: ${opts.severity.question}`, opts.severity.levels);
      return qs;
    },
    read: (a) => {
      const probs = Object.fromEntries(Object.keys(flags).map((id) => [id, readNoul(a[id]).probability]));
      const severity = opts.severity ? readScore(a.__severity).value : undefined;
      const triggered: Screened<A>["triggered"] = [];
      for (const [id, f] of Object.entries(flags)) {
        const p = probs[id]!;
        if (p >= policy.act) triggered.push({ flag: id, probability: p, action: f.action });
        else if (p >= policy.review) triggered.push({ flag: id, probability: p, action: "review" });
      }
      if (severity !== undefined && policy.escalateAtSeverity !== undefined && severity >= policy.escalateAtSeverity) {
        for (const tr of triggered) if (tr.action === "review") tr.action = opts.precedence[0]!;
      }
      triggered.sort((x, y) => y.probability - x.probability);
      const order: (A | "review" | "pass")[] = [...opts.precedence, "review", "pass"];
      let action: A | "review" | "pass" = "pass";
      for (const tr of triggered) if (order.indexOf(tr.action) < order.indexOf(action)) action = tr.action;
      return { action, triggered, flags: probs, ...(severity !== undefined ? { severity } : {}) };
    },
  };
}
