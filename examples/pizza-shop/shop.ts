// The pizza shop, as data for question-kit/service-agent: what customers come for, what to
// collect, the register's tools, and the steps. The agent runs this; the register (register.ts)
// owns the order.

import { defineService, type Templates } from "question-kit/service-agent";
import { pizzaMenu } from "./menu.ts";
import { formatPhone } from "./register.ts";

export const shop = defineService({
  intents: {
    order: {
      name: "Order food",
      description: "The customer wants pizza or drinks, or is still ordering.",
      examples: ["can I get a large pepperoni?", "two medium pizzas with mushrooms and a sprite", "hi, I'd like to order"],
    },
    // Asides: answered whenever they come up, then the order carries on (or starts).
    hours: { name: "Opening hours", description: "The customer asks when the shop is open or closes.", aside: true },
    menu: { name: "The menu", description: "The customer asks what's on the menu, what there is, or what something costs.", examples: ["what do you have?", "can I see the menu?", "what sizes are there?"], aside: true },
  },
  slots: {
    // Read by question-kit/order: items from the menu.
    items: { label: "order", menu: pizzaMenu() },
    // One of the lines the register reported after the last change.
    line: { label: "item", from: "order" },
    phone: { label: "phone number", pattern: "phone", role: "the customer's phone number", format: "10 digits", ask: "What's a good phone number to text you when it's ready?" },
  },
  tools: {
    "add-items": { name: "Add", description: "add one or more new items to the order", needs: ["items"] },
    "change-item": { name: "Change", description: "change an item already on the order: its size, toppings, number or details", needs: ["line", "items"] },
    "remove-item": { name: "Remove", description: "take an item off the order", needs: ["line"] },
    "place-order": { description: "send the order to the kitchen", needs: ["phone"], changes: true },
    "show-menu": { description: "show the menu" },
  },
  procedures: {
    order: [{ repeat: ["add-items", "change-item", "remove-item"], ask: "What can I get for you?", more: "Anything else?" }, "place-order"],
    hours: [{ say: "We're open 11am to 11pm every day." }],
    menu: ["show-menu"],
  },
  // Once the order is placed there's nothing else to ask: no "anything else?" round.
  wrapUps: 0,
  // The gates are the defaults: a phrase's pick needs confidence 0.7 (the register reads each change back).
});

/** The shop's own wording for what the agent says; the rest is the default. */
export const wording: Partial<Templates> = {
  askIntent: (again) => (again ? "Sorry, I didn't quite get that. What can I get for you?" : "What can I get for you?"),
  confirm: (_tool, values) => `Send it to the kitchen and text ${formatPhone(values.find((v) => v.label === "phone number")?.value)} when it's ready?`,
  done: () => "Thanks! Grab a seat.",
  handoff: () => "Let me get someone to help you at the counter.",
};
