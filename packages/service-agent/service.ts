// A service, described as data: what customers ask for, what to collect, the tools, and the steps.
//
// Everything here is plain objects (patterns aside), so a definition can live in code, a JSON file
// or a database. `defineService` checks that the parts refer to each other correctly.

import type { DateExpectation, OptionSpec } from "question-kit";

export interface IntentSpec {
  /** Short name: "Initiate Refund". */
  name: string;
  /** The broader area it belongs to, if any: "refunds and returns". */
  group?: string;
  /** The company's own description of what this covers. */
  description?: string;
  /** A few things customers have said that belong here. */
  examples?: string[];
  /**
   * The company's written procedure for it, conditions included ("If the oracle says yes, remove
   * the fee"). Jev reads it to decide optional steps. Default: the description.
   */
  procedure?: string;
}

/** Built-in patterns from question-kit's `extractValue`. */
export type PatternName = "email" | "phone" | "amount" | "number" | "zip";

export interface SlotSpec {
  /** What to call it when asking: "order ID". */
  label: string;
  /** The role, as a noun phrase, for Jev: "the customer's order ID". Default: `the customer's ${label}`. */
  role?: string;
  /** What it looks like, told to Jev with the role: "10 digits". Helps with bare values ("7655152545"). */
  format?: string;
  /** Code finds candidates with a pattern (over-finding is fine: Jev picks)… */
  pattern?: RegExp | PatternName;
  /** …or from a list of known values (names, products)… */
  list?: string[];
  /** …or the value is one of a fixed set of options, picked from what the customer said… */
  options?: Record<string, string | OptionSpec>;
  /** …or it's a date, in the past or future when no year is given. */
  date?: DateExpectation;
  /** How to ask for it. Default: "Could I have your {label}?" */
  ask?: string;
  /** Turn the picked text into the stored value. */
  normalize?: (raw: string) => string;
}

/** A slot a step needs: one slot, or any one of several ("full name or account ID"). */
export type Need = string | { anyOf: string[] };

export interface ToolSpec {
  /** Its name, for Jev and logs: "Offer Refund". Default: the tool's id. */
  name?: string;
  /** What it does, in a few words: "refund an amount to the customer". */
  description: string;
  /** Slots it needs, unless a step says otherwise. */
  needs?: Need[];
  /** It changes something (an order, an account, money): confirm with the customer first. */
  changes?: boolean;
  /** For troubleshooting tools: what the customer is asked to do ("log out and back in"). */
  instruction?: string;
  /**
   * A note or lookup the procedure can do without (recording a reason): if the customer can't give
   * its values, the agent carries on without it instead of handing off. Not allowed on changes.
   */
  skipIfMissing?: boolean;
}

export interface ToolStep {
  tool: string;
  /** Overrides the tool's own needs for this step. */
  needs?: Need[];
  /** Values fixed by the procedure, not asked for ("company_team": "purchasing department"). */
  fixed?: Record<string, string>;
  /** What a slot means at this step, when it differs from the usual: "the new payment method the customer wants". */
  roles?: Record<string, string>;
}

/** Troubleshooting: try each in turn, asking after each whether it fixed things; stop when it did. */
export interface TryStep {
  try: (string | ToolStep)[];
}

/**
 * Steps the procedure calls for only sometimes ("if the oracle says yes, refund"; "if the item has
 * shipped, refund part of the fee, otherwise waive it"). At this point Jev reads the company's
 * written procedure, the steps done so far and the conversation (with what the tools found) and
 * picks which of them, if any, to do or offer next; after each one it picks again from the rest.
 */
export interface OptionalStep {
  optional: (string | ToolStep)[];
}

/**
 * Something the agent says at this point, in the company's words ("Our pricing algorithms often
 * change an item's price."): said with its next message, without waiting for a reply. Optional
 * steps after it are picked with it in the conversation.
 */
export interface SayStep {
  say: string;
}

export type Step = string | ToolStep | TryStep | OptionalStep | SayStep;

export interface Gates {
  /** Confidence to accept an intent. Default 0.9. */
  intent: number;
  /** Confidence to accept a value. Default 0.9. */
  value: number;
  /** Confidence for a yes or no ("did that fix it?", "is your order ID …?"), as |2p − 1|. Default 0.6 (p ≥ 0.8 or ≤ 0.2). */
  yesNo: number;
  /** Confidence to act on the customer's answer to a read-back (yes, a correction, no). Default 0.8. */
  confirm: number;
  /**
   * Confidence to take an optional step Jev picked. Default 0.9. Under it, a change Jev leans toward
   * is still offered (it's read back, so the customer decides) unless `offerWhenUnsure` is false;
   * any other step isn't taken.
   */
  policy: number;
}

export interface ServiceSpec {
  intents: Record<string, IntentSpec>;
  slots: Record<string, SlotSpec>;
  tools: Record<string, ToolSpec>;
  /** For each intent, its steps in order. */
  procedures: Record<string, Step[]>;
  gates?: Partial<Gates>;
  /** How many times to ask again when unsure before handing off. Default 1. */
  retries?: number;
  /** How many intents to offer when asking which one the customer means. Default 3. */
  clarifyWith?: number;
  /** How many corrections to a read-back before handing off. Default 2. */
  corrections?: number;
  /**
   * When Jev leans toward an optional change but is under the policy gate: offer it to the customer
   * (true, the default; the read-back is the offer) or skip it (false).
   */
  offerWhenUnsure?: boolean;
  /** Most times to ask "anything else?" in a chat. Default 3. */
  wrapUps?: number;
}

export interface Service extends Required<Omit<ServiceSpec, "gates">> {
  gates: Gates;
  /** Every procedure with each step in its full form. */
  steps: Record<string, NormalStep[]>;
}

/** A step in full: its tool, the slots it needs, fixed values and roles, and the group it's in. */
export interface NormalStep {
  index: number;
  /** The tool it runs ("" for a say step). */
  tool: string;
  /** For a say step: what the agent says. */
  say?: string;
  needs: Need[];
  fixed: Record<string, string>;
  roles: Record<string, string>;
  /** Troubleshooting steps sharing a group are tried in turn until one fixes the problem. */
  group?: number;
  /** Optional steps sharing a group are chosen by Jev, one at a time, or not at all. */
  optional?: number;
}

export const DEFAULT_GATES: Gates = { intent: 0.9, value: 0.9, yesNo: 0.6, confirm: 0.8, policy: 0.9 };

export function defineService(spec: ServiceSpec): Service {
  const problems: string[] = [];
  const steps: Record<string, NormalStep[]> = {};
  for (const [id, s] of Object.entries(spec.slots)) {
    const kinds = [s.pattern, s.list, s.options, s.date].filter((x) => x !== undefined).length;
    if (kinds !== 1) problems.push(`slot "${id}" needs exactly one of pattern, list, options or date (has ${kinds})`);
  }
  for (const [intent, list] of Object.entries(spec.procedures)) {
    if (!(intent in spec.intents)) problems.push(`procedure for unknown intent "${intent}"`);
    const out: NormalStep[] = [];
    let group = 0;
    let optional = 0;
    const add = (s: string | ToolStep, where: { group?: number; optional?: number } = {}) => {
      const t = typeof s === "string" ? { tool: s } : s;
      const tool = spec.tools[t.tool];
      if (!tool) {
        problems.push(`${intent}: unknown tool "${t.tool}"`);
        return;
      }
      const needs = t.needs ?? tool.needs ?? [];
      for (const n of needs) for (const sl of needSlots(n)) if (!(sl in spec.slots)) problems.push(`${intent}: ${t.tool} needs unknown slot "${sl}"`);
      out.push({ index: out.length, tool: t.tool, needs, fixed: t.fixed ?? {}, roles: t.roles ?? {}, ...where });
    };
    for (const s of list) {
      if (typeof s === "object" && "say" in s) {
        if (!s.say.trim()) problems.push(`${intent}: a say step with no text`);
        out.push({ index: out.length, tool: "", say: s.say, needs: [], fixed: {}, roles: {} });
      } else if (typeof s === "object" && "try" in s) {
        group++;
        for (const t of s.try) add(t, { group });
      } else if (typeof s === "object" && "optional" in s) {
        optional++;
        for (const t of s.optional) add(t, { optional });
      } else add(s);
    }
    steps[intent] = out;
  }
  for (const intent of Object.keys(spec.intents)) if (!(intent in spec.procedures)) problems.push(`intent "${intent}" has no procedure`);
  for (const [id, t] of Object.entries(spec.tools)) if (t.skipIfMissing && t.changes) problems.push(`tool "${id}" changes something, so it can't be skipIfMissing`);
  if (problems.length) throw new Error(`defineService:\n  ${problems.join("\n  ")}`);
  return {
    intents: spec.intents,
    slots: spec.slots,
    tools: spec.tools,
    procedures: spec.procedures,
    gates: { ...DEFAULT_GATES, ...spec.gates },
    retries: spec.retries ?? 1,
    clarifyWith: spec.clarifyWith ?? 3,
    corrections: spec.corrections ?? 2,
    offerWhenUnsure: spec.offerWhenUnsure ?? true,
    wrapUps: spec.wrapUps ?? 3,
    steps,
  };
}

/** The slot ids a need can be met by. */
export function needSlots(n: Need): string[] {
  return typeof n === "string" ? [n] : n.anyOf;
}
