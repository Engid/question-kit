// takeOrder: one customer message in, a structured order out, plus whether to accept it as is or
// read it back to the customer.
//
//   1. Code looks every word up in the menu ("oat milk" → OAT, "a little" → light).
//   2. Jev, one call: what is each word the menu doesn't know? ("more" → extra, "lattes" → latte)
//   3. Code groups the tagged words into items.
//   4. Jev, one call: the order read back next to what the customer said; is anything wrong?
//   5. Accept the order if every check answer says it's probably right; otherwise read back the
//      items the check doubts (and ask "anything else?" if it thinks something is missing).

import { type Answer, ask, type JevCall, type JevClient, topChoice, yes } from "./jev.ts";
import type { Menu } from "./menu.ts";
import { type OrderItem, sameItems } from "./order.ts";
import { checkQuestions, checkState, pickQuestion, pickSwap, readBackLines, wordsState, wordTagQuestions } from "./questions.ts";
import { assemble, menuTags, type Tag, tokenize } from "./rules.ts";

export type Design = "gaps" | "every-word" | "pick";

export interface TakeOrderOptions {
  /**
   * How words get their tags:
   *   "gaps" (default)  the menu tags the words it knows; Jev tags the rest
   *   "every-word"      Jev tags every word; for menus without good lists of ways to say things
   *   "pick"            both; when their orders differ, Jev picks the one the customer said (costs both)
   */
  design?: Design;
  /** Read the finished order back to Jev and ask whether it's wrong. Default true. */
  check?: boolean;
  /**
   * Read the order back to the customer when any check answer (an item, or "anything missing?")
   * gives P(wrong) at least this. Default 0.3, the edge of the "uncertain" band in TypeSafe's
   * self-consistency cookbook. Lower reads back more orders and lets fewer mistakes through.
   */
  readBackAt?: number;
}

export interface WordReading {
  word: string;
  tag: Tag;
  /** Who tagged it: the menu's phrases, or Jev (with its probability). */
  by: "menu" | "jev";
  p?: number;
}

export interface OrderCheck {
  /** P(wrong) for the whole order in one question. */
  whole: number;
  /** P(wrong) for each item. */
  items: number[];
  /** P(the customer asked for something the order leaves out). */
  missing: number;
}

export interface OrderResult {
  text: string;
  words: WordReading[];
  items: OrderItem[];
  /** Each item's words, as [first, last] word numbers (from 1). */
  spans: [number, number][];
  /** One line per item, as a clerk would say it. */
  readBack: string[];
  check?: OrderCheck;
  /** Accept the order as is (true), or read it back to the customer first (false). */
  accept: boolean;
  /** When not accepting: the items (from 1) to confirm, and whether to ask if anything is missing. */
  confirm: { items: number[]; missing: boolean };
  /** The lowest probability among the word tags Jev gave (1 if Jev tagged nothing). */
  confidence: number;
  /** With design "pick": whether the two designs agreed, and if not, which order Jev picked. */
  pick?: { agreed: boolean; choice?: "gaps" | "every-word" | "neither"; p?: number };
  /** Every Jev request and its answers. */
  calls: JevCall[];
  /** What code did, in order, for logs: `afterCall` is how many requests had been made by then. */
  notes: { afterCall: number; text: string }[];
}

interface Tagged {
  tags: Tag[];
  readings: WordReading[];
  confidence: number;
  items: OrderItem[];
  spans: [number, number][];
}

export async function takeOrder(text: string, menu: Menu, jev: JevClient, options: TakeOrderOptions = {}): Promise<OrderResult> {
  const design = options.design ?? "gaps";
  const readBackAt = options.readBackAt ?? 0.3;
  const words = tokenize(text);
  const calls: JevCall[] = [];
  const notes: OrderResult["notes"] = [];
  const note = (t: string) => notes.push({ afterCall: calls.length, text: t });

  let chosen: Tagged;
  let pick: OrderResult["pick"];
  if (design === "pick") {
    const a = await tagWords(text, words, menu, jev, calls, "gaps");
    const b = await tagWords(text, words, menu, jev, calls, "every-word");
    if (sameItems(a.items, b.items)) {
      note("Both designs built the same order.");
      chosen = { ...a, confidence: Math.max(a.confidence, b.confidence) };
      pick = { agreed: true };
    } else {
      const swap = pickSwap(text);
      const q = pickQuestion(text, a.items, b.items, menu, swap);
      const [choice, p] = topChoice((await ask(jev, calls, "pick between the two orders", q.state, q.questions)).pick) ?? ["neither", 0];
      const second = choice !== "neither" && (choice === "a") === swap;
      chosen = second ? b : a;
      pick = { agreed: false, choice: choice === "neither" ? "neither" : second ? "every-word" : "gaps", p };
      note(`The designs disagree; Jev picked ${pick.choice} (p ${p.toFixed(2)}).`);
    }
  } else {
    chosen = await tagWords(text, words, menu, jev, calls, design);
  }
  note(`Grouped into ${chosen.items.length} item${chosen.items.length === 1 ? "" : "s"}.`);

  const readBack = readBackLines(chosen.items, menu);
  let check: OrderCheck | undefined;
  if (options.check ?? true) {
    const answers = await ask(jev, calls, "check the order read back", checkState(text, chosen.items, menu), checkQuestions(chosen.items, menu));
    const pWrong = (a: Answer | undefined) => yes(a) ?? 1;
    check = { whole: pWrong(answers.check_order), items: chosen.items.map((_, k) => pWrong(answers[`check_i${k + 1}`])), missing: pWrong(answers.check_missing) };
    note(`Check, P(wrong): ${check.items.map((p, k) => `item ${k + 1} ${p.toFixed(2)}`).join(", ") || "no items"}, anything missing ${check.missing.toFixed(2)}.`);
  }

  let accept: boolean;
  let confirm: OrderResult["confirm"];
  if (check) {
    confirm = { items: check.items.flatMap((p, k) => (p >= readBackAt ? [k + 1] : [])), missing: check.missing >= readBackAt || chosen.items.length === 0 };
    accept = confirm.items.length === 0 && !confirm.missing;
  } else {
    // Without the check, fall back to Jev's own confidence in the words.
    accept = chosen.items.length > 0 && (pick ? pick.agreed || (pick.choice !== "neither" && (pick.p ?? 0) >= 0.9) : chosen.confidence >= 0.9);
    confirm = { items: accept ? [] : chosen.items.map((_, k) => k + 1), missing: !accept };
  }

  return {
    text,
    words: chosen.readings,
    items: chosen.items,
    spans: chosen.spans,
    readBack,
    ...(check ? { check } : {}),
    accept,
    confirm,
    confidence: chosen.confidence,
    ...(pick ? { pick } : {}),
    calls,
    notes,
  };
}

/** Steps 1–3: tag the words (menu and/or Jev) and group them into items. */
async function tagWords(text: string, words: string[], menu: Menu, jev: JevClient, calls: JevCall[], design: "gaps" | "every-word"): Promise<Tagged> {
  const known = design === "gaps" ? menuTags(words, menu) : ["", ...words.map(() => "none")];
  const asked = words.map((_, i) => i + 1).filter((w) => design === "every-word" || known[w] === "none");
  const answers = await ask(jev, calls, design === "gaps" ? "tags for the words the menu doesn't know" : "what each word is", wordsState(text, words), wordTagQuestions(asked, menu));
  const tags = [...known];
  const readings: WordReading[] = words.map((word, i) => ({ word, tag: known[i + 1]!, by: "menu" }));
  const ps: number[] = [];
  for (const w of asked) {
    const top = topChoice(answers[`tag_w${w}`]);
    if (!top) continue;
    const [tag, p] = top;
    ps.push(p);
    readings[w - 1] = { word: words[w - 1]!, tag, by: "jev", p };
    if (tag !== "none") tags[w] = tag;
  }
  const { items, spans } = assemble(words, tags, menu);
  return { tags, readings, confidence: ps.length ? Math.min(...ps) : 1, items, spans };
}
