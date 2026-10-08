// What the agent says, from templates. The app can pass its own; no model writes text.

import type { IntentSpec, SlotSpec, ToolSpec } from "./service.ts";

export interface Templates {
  askIntent(again: boolean): string;
  clarify(intents: IntentSpec[]): string;
  ask(slots: SlotSpec[], again: boolean): string;
  checkValue(slot: SlotSpec, value: string): string;
  confirm(tool: ToolSpec, values: { label: string; value: string }[]): string;
  askFixed(tool: ToolSpec): string;
  handoff(reason: string): string;
  wrapUp(again: boolean): string;
  done(): string;
}

const joined = (xs: string[], word: "or" | "and") => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} ${word} ${xs.at(-1)}`);

export const defaultTemplates: Templates = {
  askIntent: (again) => (again ? "Sorry, I didn't quite get that. What can I help you with today?" : "How can I help you today?"),
  clarify: (intents) => `Just to check I've got it right: is this about ${joined(intents.map((i) => i.name.toLowerCase()), "or")}?`,
  ask: (slots, again) => {
    const what = joined(slots.map((s) => s.label), "and");
    if (again) return `Sorry, I didn't catch that. Could you give me your ${what} again?`;
    return slots.length === 1 && slots[0]!.ask ? slots[0]!.ask : `Could I have your ${what}?`;
  },
  checkValue: (slot, value) => `Just to check, is your ${slot.label} ${value}?`,
  confirm: (tool, values) => `Just to confirm, I'll ${tool.description}${values.length ? ` (${values.map((v) => `${v.label}: ${v.value}`).join(", ")})` : ""}. Shall I go ahead?`,
  askFixed: (tool) => `Could you ${tool.instruction ?? tool.description}, and let me know if that fixes it?`,
  handoff: () => "I'm going to pass you to a colleague who can help with this.",
  wrapUp: (again) => (again ? "Sorry, is there anything else I can help you with?" : "Is there anything else I can help you with?"),
  done: () => "Thanks for contacting us. Have a great day!",
};
