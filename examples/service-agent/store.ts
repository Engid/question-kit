// A small outdoor-gear store's customer service, as data, with a stand-in for its order system.
//
// Three requests, each showing a different part of the agent:
//   - a return or refund: Jev reads the store's written policy and what the order lookup found, and
//     picks a refund, store credit or neither (the customer still confirms any change);
//   - a faster or slower delivery: allowed only if the order hasn't shipped, which the lookup says;
//   - a password reset: one value to collect, no change to confirm.
//
// The store, its orders and its customers are made up.

import type { Json } from "question-kit";
import { defineService } from "question-kit/service-agent";

export const service = defineService({
  intents: {
    refund: {
      name: "Return or refund",
      description: "The customer wants to return an item or get their money back for it.",
      examples: ["I want to return my boots", "can I get a refund for order 1234567890?", "the jacket I got is torn"],
      procedure: [
        "Look up the order. Then:",
        "- If the item arrived damaged or isn't what they ordered, refund the full price to the original payment method.",
        "- Otherwise, if it was delivered in the last 30 days, offer store credit for the full price.",
        "- Otherwise the 30-day return window has passed: offer neither.",
      ].join("\n"),
    },
    shipping: {
      name: "Change delivery speed",
      description: "The customer wants their order to arrive sooner, or doesn't mind it arriving later.",
      examples: ["can I get my order faster?", "please upgrade my order to overnight"],
      procedure: "Look up the order. If it hasn't shipped yet, change the shipping speed to the one the customer asks for. If it has shipped, it can't be changed.",
    },
    password: {
      name: "Reset password",
      description: "The customer can't sign in or has forgotten their password.",
      examples: ["I forgot my password", "I can't log in to my account"],
    },
  },
  slots: {
    order_id: { label: "order ID", format: "10 digits", pattern: /\b\d{10}\b/g },
    email: { label: "email address", pattern: "email" },
    // Filled by the order lookup, not asked for.
    amount: { label: "amount", pattern: "amount" },
    speed: {
      label: "shipping speed",
      role: "the shipping speed the customer wants",
      options: { standard: "standard (5 to 7 days)", express: "express (2 days)", overnight: "overnight" },
    },
  },
  tools: {
    "look-up-order": { name: "Look Up Order", description: "find the order and what's in it", needs: ["order_id", "email"] },
    refund: { name: "Refund", description: "refund the price to the original payment method", needs: ["amount"], changes: true },
    "store-credit": { name: "Store Credit", description: "give store credit for the price", needs: ["amount"], changes: true },
    "change-speed": { name: "Change Shipping Speed", description: "change how fast the order ships", needs: ["speed"], changes: true },
    "send-reset": { name: "Send Reset Link", description: "email a link to reset the password", needs: ["email"] },
  },
  procedures: {
    refund: ["look-up-order", { optional: ["refund", "store-credit"] }],
    shipping: ["look-up-order", { optional: ["change-speed"] }],
    password: ["send-reset"],
  },
});

/** The made-up order system. */
export const ORDERS: Record<string, { email: string; item: string; price: string; status: string }> = {
  "1234567890": { email: "ana@example.com", item: "hiking boots", price: "120.00", status: "delivered 12 days ago" },
  "5550001111": { email: "ana@example.com", item: "rain jacket", price: "85.00", status: "not shipped yet" },
  "9876543210": { email: "sam@example.com", item: "two-person tent", price: "240.00", status: "delivered 45 days ago" },
};

/**
 * Run a tool against the made-up order system. `note` is what the system found, in words: the agent
 * puts it in the conversation Jev reads. `values` fill slots the customer isn't asked for.
 */
export function runTool(tool: string, given: Record<string, Json>): { ok: boolean; note?: string; values?: Record<string, string> } {
  // This store's slots are all text.
  const values = Object.fromEntries(Object.entries(given).map(([k, v]) => [k, String(v)]));
  if (tool === "look-up-order") {
    const order = ORDERS[values.order_id ?? ""];
    if (!order || order.email !== values.email?.toLowerCase()) return { ok: false, note: "Look Up Order: no order with that ID and email address." };
    return { ok: true, values: { amount: order.price }, note: `Look Up Order: order ${values.order_id}, ${order.item}, $${order.price}, ${order.status}.` };
  }
  if (tool === "refund") return { ok: true, note: `Refund: $${values.amount} refunded to the original payment method.` };
  if (tool === "store-credit") return { ok: true, note: `Store Credit: $${values.amount} added to the account.` };
  if (tool === "change-speed") return { ok: true, note: `Change Shipping Speed: now ${values.speed}.` };
  if (tool === "send-reset") return { ok: true, note: `Send Reset Link: sent to ${values.email}.` };
  return { ok: false };
}
