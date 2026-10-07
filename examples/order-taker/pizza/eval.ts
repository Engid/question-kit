// The pizza order taker, run on the PIZZA benchmark like any of the experiment's strategies, so its
// numbers sit next to the designs it packages (`bun run pizza --strategies order-taker,…`):
//
//   order-taker              takeOrder's defaults: the menu tags what it knows, Jev the rest, then the
//                            check (the experiment's keywords-jev-fills-gaps+check)
//   order-taker/every-word   design "every-word" (jev-tags-words+check)
//   order-taker/pick         design "pick", with the check (pick-dial-1-or-3, then the check)
//
// With the menu in menu.ts it asks exactly the questions the experiment asked, so on orders the
// experiment has run, the cached answers are reused; `bun run order:pizza:verify` checks that the
// results match order for order.

import type { CallRecord, CallStats, QuestionMeta } from "../../../research/lab/calls.ts";
import type { JevClient as LabJevClient, JevRequest as LabJevRequest } from "../../../research/lab/jev/types.ts";
import { type Design, type JevCall, type JevClient, type OrderItem, type OrderResult, takeOrder } from "../../../packages/order-taker/index.ts";
import { itemToExr, orderToExr } from "../../../research/pizza/order.ts";
import type { PizzaResult, PizzaStrategy } from "../../../research/pizza/strategies.ts";
import { pizzaMenu, toPizzaItem } from "./menu.ts";

/**
 * The library says which order or item a check question is about (`checked`); the experiment's
 * scoring and oracle want it as an EXR tree. Adds `exr` to each question's meta (meta is never sent
 * to Jev).
 */
function withExr(meta: Record<string, unknown> | undefined): Record<string, QuestionMeta> {
  const out: Record<string, QuestionMeta> = {};
  for (const [id, m] of Object.entries(meta ?? {})) {
    const { checked, ...rest } = m as QuestionMeta & { checked?: unknown };
    let exr: QuestionMeta["exr"];
    if (checked !== undefined) {
      const order = (items: OrderItem[]) => orderToExr(items.map(toPizzaItem));
      if (rest.set === "order-pick") {
        const c = checked as { a: OrderItem[]; b: OrderItem[] };
        exr = { a: order(c.a), b: order(c.b) };
      } else exr = rest.level === "item" ? itemToExr(toPizzaItem(checked as OrderItem)) : order(checked as OrderItem[]);
    }
    out[id] = { ...rest, ...(exr !== undefined ? { exr } : {}) };
  }
  return out;
}

function client(jev: LabJevClient): JevClient {
  return { systemOne: (request) => jev.systemOne({ ...request, meta: withExr(request.meta) } as LabJevRequest) as ReturnType<JevClient["systemOne"]> };
}

/** The order taker's result as one of the experiment's results, for scoring and the report card. */
export function toPizzaResult(name: string, r: OrderResult): PizzaResult {
  const calls: CallRecord[] = r.calls.map((c: JevCall) => ({
    title: c.title,
    part: c.part,
    parts: c.parts,
    request: c.request as LabJevRequest,
    response: c.response as CallRecord["response"],
    meta: withExr(c.request.meta),
    ms: c.ms,
  }));
  const stats: CallStats = { requests: calls.length, questions: 0, jevMs: 0, inputTokens: 0, outputTokens: 0, requestChars: 0 };
  for (const c of calls) {
    stats.questions += Object.keys(c.request.questions).length;
    stats.jevMs += c.ms;
    stats.inputTokens += c.response.usage?.input_tokens ?? 0;
    stats.outputTokens += c.response.usage?.output_tokens ?? 0;
    stats.requestChars += JSON.stringify({ state: c.request.state, questions: c.request.questions }).length;
  }
  const items = r.items.map(toPizzaItem);
  return {
    strategy: name,
    items,
    exr: orderToExr(items),
    spans: r.spans,
    calls,
    steps: r.notes.map((n) => ({ afterRequest: n.afterCall, text: n.text })),
    stats,
    confidence: r.confidence,
    ...(r.check ? { check: { whole: r.check.whole, parts: Math.max(...r.check.items, r.check.missing) } } : {}),
    ...(r.pick
      ? {
          agreed: r.pick.agreed,
          ...(r.pick.agreed ? {} : { pick: { choice: r.pick.choice === "every-word" ? ("second" as const) : r.pick.choice === "gaps" ? ("first" as const) : ("neither" as const), p: r.pick.p ?? 0 } }),
        }
      : {}),
  };
}

function orderTaker(name: string, design: Design, summary: string): PizzaStrategy {
  return {
    name,
    group: "library",
    usesJev: true,
    summary,
    async parse(input, jev) {
      return toPizzaResult(name, await takeOrder(input.text, pizzaMenu(), client(jev), { design }));
    },
  };
}

export const PIZZA_ORDER_TAKER: PizzaStrategy[] = [
  orderTaker("order-taker", "gaps", "packages/order-taker's takeOrder with the pizza menu and its defaults: the menu tags what it knows, Jev the rest, then Jev checks the order read back (keywords-jev-fills-gaps+check)."),
  orderTaker("order-taker/every-word", "every-word", "takeOrder with design \"every-word\": Jev tags every word, then the check (jev-tags-words+check)."),
  orderTaker("order-taker/pick", "pick", "takeOrder with design \"pick\": both designs, Jev picks when they differ, then the check (pick-dial-1-or-3, then the check)."),
];
