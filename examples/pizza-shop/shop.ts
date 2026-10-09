// The pizza shop, as data for question-kit/service-agent: what customers come for, what to
// collect, the register's tools, and the steps. The agent runs this; the register (register.ts)
// owns the order.

import { defineService, type Templates } from "question-kit/service-agent";
import { menuAnswers, pizzaMenu } from "./menu.ts";
import { formatPhone } from "./register.ts";

export const shop = defineService({
  intents: {
    order: {
      name: "Order food",
      description: "The customer orders pizza or drinks, or is still ordering: naming items, with or without a please or a question mark.",
      examples: ["can I get a large pepperoni?", "two medium pizzas with mushrooms and a sprite", "two sprites", "a coke", "hi, I'd like to order"],
    },
    // Asides: answered whenever they come up, then the order carries on (or starts).
    hours: { name: "Opening hours", description: "The customer asks when the shop is open or closes.", aside: true },
    menu: { name: "The whole menu", description: "The customer asks to see the menu or what there is in general.", notFor: "ordering something", examples: ["what do you have?", "can I see the menu?"], aside: true },
    // Questions about a part of the menu, each answered from the menu data.
    sizes: { name: "Sizes", description: "The customer asks what sizes there are, or how big something is.", notFor: "ordering something in a size (that's an order)", examples: ["what sizes do you have?", "how big is a large?"], aside: true },
    crusts: { name: "Crusts and styles", description: "The customer asks about pizza crusts or styles: thin, deep dish, stuffed, gluten free.", notFor: "ordering a pizza in a style (that's an order)", examples: ["what kinds of crust do you have?", "do you do gluten free?"], aside: true },
    toppings: { name: "Toppings", description: "The customer asks which toppings there are, whether a topping is available, or what toppings cost.", notFor: "ordering a pizza with toppings, or adding a topping to one (that's an order)", examples: ["do you have mushrooms?", "what toppings are there?"], aside: true },
    drinks: { name: "Drinks", description: "The customer asks which drinks there are, or about drink sizes.", notFor: "ordering a drink, even just naming one (that's an order)", examples: ["what drinks do you have?", "do you have lemonade?"], aside: true },
    "not-on-menu": { name: "Something not on the menu", description: "The customer asks whether there's something the shop doesn't sell: sides, desserts, breadsticks, wings, salads, pasta, beer.", examples: ["do you have breadsticks?", "any desserts?"], aside: true },
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
    sizes: [{ say: menuAnswers().sizes }],
    crusts: [{ say: menuAnswers().crusts }],
    toppings: [{ say: menuAnswers().toppings }],
    drinks: [{ say: menuAnswers().drinks }],
    "not-on-menu": [{ say: "Sorry, we don't have that: it's pizzas and drinks here. Ask for the menu to see it all." }],
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
