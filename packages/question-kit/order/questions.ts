// The questions the order taker asks Jev, as question-kit tasks built from the menu: `choose` for
// the words and the pick, `check` for the read-back. Every question names what it reads by a path
// into the state (`words.w3`, `summary.i1`), and every option says what it means.
//
//   word tags   What is this word in the order? One Choice over the whole menu: every number and
//               every field's values, plus "no", the amounts ("extra", "light"), the words for the
//               items themselves, and "nothing". One task per word, all sent together.
//   check       The finished order read back next to what the customer said: is it wrong? Asked for
//               the whole order, for each item, and "is anything missing?". Phrased so that yes means
//               wrong, as in TypeSafe's verification cascade
//               (https://docs.typesafe.ai/cookbooks/sde_cascade.md).
//   pick        Two orders built two ways, when they differ: which one did the customer say?
//
// The tasks own no state: they point at parts the caller sends (`wordsState`, `checkState`,
// `pickState`), so several tasks about the same order share one copy of it.

import { check, type ChoiceReading, choose, type Entry, type NoulReading, q, ref, type Ref, type Task } from "../core/index.ts";
import { aliasesOf, lookalikesOf, type Menu, type MenuValue } from "./menu.ts";
import { defaultReadBack, type OrderItem } from "./order.ts";
import { tagOf } from "./rules.ts";

/** What a question is about, for logs and for explaining an order; kept in the request's `meta`, never sent. */
export interface About {
  set: "word-tag" | "order-check" | "order-pick";
  level?: "tag" | "whole" | "item" | "missing";
  word?: number;
  item?: number;
  checked?: unknown;
}

/** A set of tasks sent together, and what each one's question is about. */
export interface Asked<T> {
  tasks: Record<string, Task<T>>;
  about: Record<string, About>;
}

/** "a, b or c" */
const either = (xs: string[], word = "or") => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${word} ${xs.at(-1)}`);

/** "green peppers (also written: green pepper)" */
function describe(v: MenuValue, menu: Menu): string {
  const also = aliasesOf(v, menu);
  return `${v.name}${also.length ? ` (also written: ${also.join(", ")})` : ""}`;
}

/** The options of the word-tag question: option id → what it means. */
export function wordTagOptions(menu: Menu): Record<string, string> {
  const out: Record<string, string> = { none: "Not part of what is ordered: greetings, filler like 'i want', 'please', 'with', 'and'" };
  for (const k of menu.kinds) if (k.words.length) out[k.id] = `The word for the ${k.id} itself: ${k.words.join(", ")}`;
  out.not = menu.wording.not;
  for (const a of menu.amounts) out[tagOf(a)] = a.describe;
  for (const n of menu.numbers) {
    const said = n.say.filter((s) => /[a-z]/.test(s)).slice(0, 3);
    out[tagOf(n)] = `The quantity ${n.id}${said.length ? ` (${said.map((s) => `'${s}'`).join(", ")})` : ""}`;
  }
  for (const f of menu.fields) {
    for (const v of f.values) {
      // Names and list values are easy to mix up with longer ones: "not the same as green peppers".
      const look = f.names || f.many ? lookalikesOf(v, menu).map((o) => o.name) : [];
      out[tagOf(v)] = `${f.label}: ${describe(v, menu)}${look.length ? `; not the same as ${look.join(", ")}` : ""}`;
    }
  }
  return out;
}

/** The state the word questions read: the order and each word by number. */
export const wordsState = (text: string, words: string[]): Record<string, Entry> => ({ order: text, words: Object.fromEntries(words.map((w, i) => [`w${i + 1}`, w])) });

/** "What is this word in the order?" for one word, given where the order and the word are. */
export function wordTag(order: Ref, word: Ref, menu: Menu, options: Record<string, string> = wordTagOptions(menu)): Task<ChoiceReading> {
  const hint = menu.wording.wordHint ? ` (${menu.wording.wordHint})` : "";
  return choose(word, options, {
    none: false,
    question: (w) => q`${order} is a customer's ${menu.name} order. What is ${w} in that order? If it is part of a longer name or phrase${hint}, answer for the whole phrase.`,
  });
}

/** The word questions for each word number in `which` (from 1), about `wordsState`. */
export function wordTags(which: number[], menu: Menu): Asked<ChoiceReading> {
  const options = wordTagOptions(menu);
  const order = ref("order");
  const words = ref("words");
  const tasks: Record<string, Task<ChoiceReading>> = {};
  const about: Record<string, About> = {};
  for (const w of which) {
    tasks[`tag_w${w}`] = wordTag(order, words.at(`w${w}`), menu, options);
    about[`tag_w${w}`] = { set: "word-tag", word: w, level: "tag" };
  }
  return { tasks, about };
}

// ------------------------------------------------------------------ read-back and check

/** One line per item, using each kind's read-back (or the default). */
export function readBackLines(items: OrderItem[], menu: Menu): string[] {
  return items.map((it) => {
    const kind = menu.kinds.find((k) => k.id === it.kind);
    if (kind?.readBack) return kind.readBack(it, menu.nameOf);
    const nameField = menu.fields.find((f) => f.names && f.items.includes(it.kind))?.id;
    return defaultReadBack(it, menu.nameOf, nameField);
  });
}

/** The order read back, one line per item: { i1: "2 large lattes", i2: "1 croissant" }, or "nothing". */
export function readBackOrder(items: OrderItem[], menu: Menu): Entry {
  const lines = readBackLines(items, menu);
  return lines.length ? Object.fromEntries(lines.map((line, k) => [`i${k + 1}`, line])) : "nothing";
}

/** The state the check reads: what the customer said and what the clerk wrote down. */
export const checkState = (text: string, items: OrderItem[], menu: Menu): Record<string, Entry> => ({ order: text, summary: readBackOrder(items, menu) });

/** Is the order wrong? The whole order, each item, and anything missing (yes = wrong), about `checkState`. */
export function orderChecks(items: OrderItem[], menu: Menu): Asked<NoulReading> {
  const order = ref("order");
  const summary = ref("summary");
  const context = q`${order} is what a customer said at ${menu.place}. ${summary} is what the clerk wrote down, one line per item.`;
  const kinds = either(menu.kinds.map((k) => k.id));
  const details = either(menu.wording.details);
  const tasks: Record<string, Task<NoulReading>> = {};
  const about: Record<string, About> = {};
  tasks.check_order = check(summary, (s) => q`${context} Is ${s} wrong in any way: a ${kinds}, number, ${details} detail that is missing, extra, or different from what the customer asked for?`, {
    true: q`${summary} is wrong somewhere`,
    false: q`${summary} is exactly what the customer ordered`,
  });
  about.check_order = { set: "order-check", level: "whole", checked: items };
  items.forEach((it, i) => {
    const k = i + 1;
    const item = summary.at(`i${k}`);
    tasks[`check_i${k}`] = check(item, (s) => q`${context} Does ${s} include something the customer didn't ask for, or get a number, ${details} wrong?`, {
      true: q`Something in ${item} is wrong or wasn't asked for`,
      false: q`Everything in ${item} is what the customer asked for`,
    });
    about[`check_i${k}`] = { set: "order-check", level: "item", item: k, checked: it };
  });
  tasks.check_missing = check(summary, (s) => q`${context} Did the customer ask for something that ${s} leaves out: a whole ${kinds}, or a ${details} detail?`, {
    true: q`Something the customer asked for is missing from ${summary}`,
    false: "Nothing the customer asked for is missing",
  });
  about.check_missing = { set: "order-check", level: "missing", checked: items };
  return { tasks, about };
}

// ------------------------------------------------------------------ pick

/**
 * Which of two orders the customer said. `swap` shows the second one first, so that over many
 * orders neither way of building them always gets the first position.
 */
export function pickState(text: string, first: OrderItem[], second: OrderItem[], menu: Menu, swap: boolean): Record<string, Entry> {
  const [a, b] = swap ? [second, first] : [first, second];
  return { order: text, a: readBackOrder(a, menu), b: readBackOrder(b, menu) };
}

export function pickOrder(first: OrderItem[], second: OrderItem[], menu: Menu, swap: boolean): Asked<ChoiceReading<"a" | "b" | "neither">> {
  const [a, b] = swap ? [second, first] : [first, second];
  const kinds = either(menu.kinds.map((k) => k.id), "and");
  const ra = ref("a");
  const rb = ref("b");
  const task = choose(
    ref("order"),
    { a: q`${ra} is exactly right`, b: q`${rb} is exactly right`, neither: "Neither is exactly right" },
    {
      none: false,
      question: (o) =>
        q`${o} is what a customer said at ${menu.place}. ${ra} and ${rb} are two clerks' write-ups of it, one line per item, and they differ. Which one is exactly what the customer ordered: every ${kinds}, number, ${either(menu.wording.details, "and")} detail?`,
    },
  ) as Task<ChoiceReading<"a" | "b" | "neither">>;
  return { tasks: { pick: task }, about: { pick: { set: "order-pick", checked: { a, b } } } };
}

/** Which position to show the first order in, from the order's text (a fixed hash, so reruns ask the same question). */
export function pickSwap(text: string): boolean {
  return [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 1000003, 7) % 2 === 1;
}
