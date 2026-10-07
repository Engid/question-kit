// The order taker in lib/pizza-order-taker, run on the PIZZA benchmark like any other strategy, so
// its numbers can be compared with the lab's designs it packages:
//
//   order-taker              takeOrder's default: the menu tags what it knows, Jev the rest, then the
//                            check (the lab's keywords-jev-fills-gaps+check)
//   order-taker/every-word   design "every-word" (the lab's jev-tags-words+check)
//   order-taker/pick         design "pick", with the check (pick-rung-1-or-3, then the check)
//
// The library builds its menu from the dataset's catalogs (pizzaDatasetMenu), so it asks exactly
// the questions the lab asked: on orders the lab has run, the cached answers are reused, and the
// results must match order for order (`bun run pizza:verify-library` checks that).

import type { CallRecord, CallStats, QuestionMeta } from "../../src/calls.ts";
import type { JevClient as LabJevClient, JevRequest as LabJevRequest } from "../../src/jev/types.ts";
import { defineMenu, type Design, type JevCall, type JevClient, type Menu, type OrderResult, takeOrder } from "../../lib/pizza-order-taker/index.ts";
import { BACK_ON_WORDS, loadMenu, NOT_WORDS, PIZZA_WORDS, type Slot as LabSlot } from "./menu.ts";
import { type Item, itemToExr, orderToExr } from "./order.ts";
import type { PizzaResult, PizzaStrategy } from "./strategies.ts";

let cached: Menu | undefined;

/** The library's menu, from the dataset's catalogs: every entry, name and way of saying it, in catalog order. */
export function pizzaDatasetMenu(): Menu {
  if (cached) return cached;
  const lab = loadMenu();
  const slot = (s: LabSlot) => Object.fromEntries(lab.entries.filter((e) => e.slot === s).map((e) => [e.entity, { name: e.label, say: e.surfaces }]));
  cached = defineMenu({
    numbers: slot("number"),
    sizes: slot("size"),
    styles: slot("style"),
    toppings: slot("topping"),
    drinks: slot("drink"),
    containers: slot("container"),
    volumes: slot("volume"),
    amounts: { EXTRA: lab.get("quantity", "EXTRA")?.surfaces ?? [], LIGHT: lab.get("quantity", "LIGHT")?.surfaces ?? [] },
    words: { pizza: [...PIZZA_WORDS], not: [...NOT_WORDS], backOn: [...BACK_ON_WORDS] },
  });
  return cached;
}

/**
 * The library says which order or item a check question is about (`checked`); the lab's scoring and
 * oracle want it as an EXR tree. Adds `exr` to each question's meta (meta is never sent to Jev).
 */
function withExr(meta: Record<string, unknown> | undefined): Record<string, QuestionMeta> {
  const out: Record<string, QuestionMeta> = {};
  for (const [id, m] of Object.entries(meta ?? {})) {
    const { checked, ...rest } = m as QuestionMeta & { checked?: unknown };
    let exr: QuestionMeta["exr"];
    if (checked !== undefined) {
      if (rest.set === "order-pick") {
        const c = checked as { a: Item[]; b: Item[] };
        exr = { a: orderToExr(c.a), b: orderToExr(c.b) };
      } else exr = rest.level === "item" ? itemToExr(checked as Item) : orderToExr(checked as Item[]);
    }
    out[id] = { ...rest, ...(exr !== undefined ? { exr } : {}) };
  }
  return out;
}

function client(jev: LabJevClient): JevClient {
  return { systemOne: (request) => jev.systemOne({ ...request, meta: withExr(request.meta) } as LabJevRequest) as ReturnType<JevClient["systemOne"]> };
}

/** The library's result as a lab result, for scoring and the report card. */
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
  return {
    strategy: name,
    items: r.items,
    exr: orderToExr(r.items),
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
      return toPizzaResult(name, await takeOrder(input.text, pizzaDatasetMenu(), client(jev), { design }));
    },
  };
}

export const PIZZA_LIBRARY: PizzaStrategy[] = [
  orderTaker("order-taker", "gaps", "lib/pizza-order-taker's takeOrder with its defaults: the menu tags what it knows, Jev the rest, then Jev checks the order read back (the lab's keywords-jev-fills-gaps+check)."),
  orderTaker("order-taker/every-word", "every-word", "takeOrder with design \"every-word\": Jev tags every word, then the check (the lab's jev-tags-words+check)."),
  orderTaker("order-taker/pick", "pick", "takeOrder with design \"pick\": both designs, Jev picks when they differ, then the check (pick-rung-1-or-3, then the check)."),
];
