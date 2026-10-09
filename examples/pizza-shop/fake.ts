// A stand-in for Jev that follows a few rules of thumb, so the screen can be tried without an API
// key (`--fake`) and a run can be priced. It doesn't read anything: it tags no words (the menu's
// own word lists do all the work), takes every phrase as adding items unless it has "take off",
// "remove", "make", "put", "change" or "instead" in it, and says the customer is done when they
// say "that's all" or "that's it". Don't judge Jev by it.

import type { Answer, Question, SystemOneClient } from "question-kit";
import { fakeJev } from "question-kit";

function pick(q: Question, choice: string, p: number): Answer {
  const keys = Object.keys((q as { criteria: Record<string, unknown> }).criteria);
  const rest = (1 - p) / Math.max(1, keys.length - 1);
  return { type: "choice", choice, probabilities: Object.fromEntries(keys.map((k) => [k, k === choice ? p : rest])) };
}

export function fakeShopClient(): SystemOneClient {
  return fakeJev((id, q, state) => {
    const st = state as Record<string, unknown>;
    const keys = q.type === "choice" ? Object.keys(q.criteria) : [];
    const last = (t: unknown) => String(t).split("\n").at(-1)!.replace(/^customer: /, "");
    const which = (t: string) => (/open|close|hours/i.test(t) ? "hours" : /menu|what do you have|what sizes|how much/i.test(t) ? "menu" : null);
    if (id === "label") return pick(q, which(last(st.customer ?? st.chat)) ?? "order", 0.98);
    if (id.startsWith("tag_w")) return "none";
    const [task] = id.split("::") as [string];
    if (task === "aside") return pick(q, which(last(st.message ?? st.chat)) ?? "none", 0.98);
    if (task === "finished") return { type: "noul", noul: /that'?s (all|it|everything)|nothing else|i'?m (done|good)/i.test(String(st.message)) ? 0.96 : 0.03 };
    if (task === "right") return { type: "noul", noul: /^(yes|yep|yeah|right|correct|that'?s right)/i.test(String(st.message)) ? 0.95 : 0.05 };
    // The check after a change: the stand-in never doubts (it can't read).
    if (task === "missing" || /^i\d+$/.test(task)) return { type: "noul", noul: 0.02 };
    if (/^p\d+$/.test(task)) {
      const text = (st.phrases as Record<string, string>)[task] ?? "";
      const order = (st.order as Record<string, string>) ?? {};
      const lines = Object.keys(order);
      const on = text.match(/\b(first|second|third)\b/)?.[0];
      const words = new Set(text.split(" "));
      const named = lines.find((id) => order[id]!.split(/[ ,]+/).some((w) => w.length > 3 && (words.has(w) || words.has(w.replace(/s$/, "")))));
      const line = on === "first" ? lines[0] : on === "second" ? lines[1] : on === "third" ? lines[2] : (named ?? lines.at(-1));
      const want = /take off|remove|scratch|forget/.test(text) ? `remove-item@${line}` : /make|put|change|instead|switch|add .* to (that|it)/.test(text) ? `change-item@${line}` : "add-items";
      return pick(q, keys.includes(want) ? want : keys.includes("add-items") ? "add-items" : "none", 0.97);
    }
    if (task === "confirm") return pick(q, /^(no|nope|wait|actually)/i.test(String(st.chat).split("\n").at(-1)?.replace(/^customer: /, "") ?? "") ? "no" : "yes", 0.96);
    if (task.startsWith("slot_")) return pick(q, keys.find((k) => /\d{3}/.test(k)) ?? "none", 0.97);
    return { type: "noul", noul: 0.05 };
  });
}
