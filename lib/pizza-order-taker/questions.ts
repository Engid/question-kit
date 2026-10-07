// The questions the order taker asks Jev. Every question names what it reads by a path into the
// state (`words.w3`, `summary.i1`), and every option says what it means.
//
//   word tags   What is this word in the order? One Choice over the whole menu (~170 options for
//               the PIZZA menu): every number, size, style, topping, drink, container and volume,
//               plus "no", "extra", "light", "the pizza itself" and "nothing".
//   check       The finished order read back next to what the customer said: is it wrong? Asked
//               for the whole order, for each item, and "is anything missing?". Phrased so that
//               yes means wrong, as in TypeSafe's verification cascade
//               (https://docs.typesafe.ai/cookbooks/sde_cascade.md).
//   pick        Two orders built two ways, when they differ: which one did the customer say?
//
// These are the exact questions measured in examples/pizza (rungs 1 and 3, `+check`, `pick-rung-1-or-3`).

import type { Asked, Entry } from "./jev.ts";
import { aliasesOf, lookalikesOf, type Menu, type MenuEntry, type Slot } from "./menu.ts";
import { type Item, readBack } from "./order.ts";
import { tagOf } from "./rules.ts";

const SLOT_WORD: Record<Slot, string> = {
  number: "How many",
  size: "Size",
  style: "Pizza style",
  topping: "Topping",
  drink: "Drink",
  container: "Container",
  volume: "Drink volume",
  amount: "Amount of a topping",
};

const TAGGED_SLOTS: Slot[] = ["number", "size", "style", "topping", "drink", "container", "volume"];

/** "green peppers (also written: green pepper)" */
function describe(e: MenuEntry, menu: Menu): string {
  const also = aliasesOf(e, menu);
  return `${e.name}${also.length ? ` (also written: ${also.join(", ")})` : ""}`;
}

/** The options of the word-tag question: option id → what it means. */
export function wordTagOptions(menu: Menu): Record<string, string> {
  const out: Record<string, string> = {
    none: "Not part of what is ordered: greetings, filler like 'i want', 'please', 'with', 'and'",
    pizza: "The word for the pizza itself: pizza, pie, pizzas, pies",
    not: "Says not to include something: no, without, hold, avoid, don't, leave off",
    extra: "More of a topping: extra, lots of, heavy on",
    light: "Less of a topping: light, a little, not much",
  };
  for (const slot of TAGGED_SLOTS) {
    for (const e of menu.bySlot[slot]) {
      if (slot === "number") {
        out[tagOf(e)] = `The quantity ${e.id}${e.id === "1" ? " ('a', 'an', 'one')" : ` ('${e.say.find((s) => /[a-z]/.test(s)) ?? e.id}')`}`;
        continue;
      }
      const look = slot === "topping" || slot === "style" || slot === "drink" ? lookalikesOf(e, menu).map((o) => o.name) : [];
      out[tagOf(e)] = `${SLOT_WORD[slot]}: ${describe(e, menu)}${look.length ? `; not the same as ${look.join(", ")}` : ""}`;
    }
  }
  return out;
}

/** The state the word questions read: the order and each word by number. */
export const wordsState = (text: string, words: string[]): Entry => ({ order: text, words: Object.fromEntries(words.map((w, i) => [`w${i + 1}`, w])) });

/** "What is this word?" for each word number in `which` (from 1). */
export function wordTagQuestions(which: number[], menu: Menu): Record<string, Asked> {
  const criteria = wordTagOptions(menu);
  return Object.fromEntries(
    which.map((w) => [
      `tag_w${w}`,
      {
        question: {
          type: "choice",
          instructions: `\`order\` is a customer's pizza and drink order. What is \`words.w${w}\` in that order? If it is part of a longer name or phrase (like "black" in "black olives", or "a" in "a little"), answer for the whole phrase.`,
          criteria,
        },
        about: { set: "word-tag", word: w, level: "tag" },
      },
    ]),
  );
}

// ------------------------------------------------------------------ check

/** The order read back, one line per item: { i1: "2 large pizzas with ham", i2: "1 coke" }, or "nothing". */
export function readBackOrder(items: Item[], menu: Menu): Entry {
  const lines = readBackLines(items, menu);
  return lines.length ? Object.fromEntries(lines.map((line, k) => [`i${k + 1}`, line])) : "nothing";
}

/** One line per item, with the menu's names. */
export function readBackLines(items: Item[], menu: Menu): string[] {
  const name = (slot: string, id: string) => menu.get(slot as Slot, id)?.name ?? id.toLowerCase().replace(/_/g, " ");
  return items.map((it) => readBack(it, name));
}

const CHECK_CONTEXT = "`order` is what a customer said at a pizza counter. `summary` is what the clerk wrote down, one line per item.";

export const checkState = (text: string, items: Item[], menu: Menu): Entry => ({ order: text, summary: readBackOrder(items, menu) });

/** Is the order wrong? The whole order, each item, and anything missing (yes = wrong). */
export function checkQuestions(items: Item[]): Record<string, Asked> {
  const out: Record<string, Asked> = {
    check_order: {
      question: {
        type: "noul",
        instructions: `${CHECK_CONTEXT} Is \`summary\` wrong in any way: a pizza or drink, number, size, style, topping or drink detail that is missing, extra, or different from what the customer asked for?`,
        criteria: { true: "`summary` is wrong somewhere", false: "`summary` is exactly what the customer ordered" },
      },
      about: { set: "order-check", level: "whole", checked: items },
    },
  };
  items.forEach((it, i) => {
    const k = i + 1;
    out[`check_i${k}`] = {
      question: {
        type: "noul",
        instructions: `${CHECK_CONTEXT} Does \`summary.i${k}\` include something the customer didn't ask for, or get a number, size, style, topping or drink wrong?`,
        criteria: { true: `Something in \`summary.i${k}\` is wrong or wasn't asked for`, false: `Everything in \`summary.i${k}\` is what the customer asked for` },
      },
      about: { set: "order-check", level: "item", item: k, checked: it },
    };
  });
  out.check_missing = {
    question: {
      type: "noul",
      instructions: `${CHECK_CONTEXT} Did the customer ask for something that \`summary\` leaves out: a whole pizza or drink, or a size, style, topping or drink detail?`,
      criteria: { true: "Something the customer asked for is missing from `summary`", false: "Nothing the customer asked for is missing" },
    },
    about: { set: "order-check", level: "missing", checked: items },
  };
  return out;
}

// ------------------------------------------------------------------ pick

/**
 * Which of two orders the customer said. `swap` shows the second one first, so that over many
 * orders neither way of building them always gets the first position.
 */
export function pickQuestion(text: string, first: Item[], second: Item[], menu: Menu, swap: boolean): { state: Entry; questions: Record<string, Asked> } {
  const [a, b] = swap ? [second, first] : [first, second];
  return {
    state: { order: text, a: readBackOrder(a, menu), b: readBackOrder(b, menu) },
    questions: {
      pick: {
        question: {
          type: "choice",
          instructions:
            "`order` is what a customer said at a pizza counter. `a` and `b` are two clerks' write-ups of it, one line per item, and they differ. Which one is exactly what the customer ordered: every pizza and drink, number, size, style, topping and drink detail?",
          criteria: { a: "`a` is exactly right", b: "`b` is exactly right", neither: "Neither is exactly right" },
        },
        about: { set: "order-pick", checked: { a, b } },
      },
    },
  };
}

/** Which position to show the first order in, from the order's text (a fixed hash, so reruns ask the same question). */
export function pickSwap(text: string): boolean {
  return [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 1000003, 7) % 2 === 1;
}
