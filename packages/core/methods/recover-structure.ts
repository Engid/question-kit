// recoverStructure: rebuild Markdown from text that lost its formatting.
//
// Two requests, and code writes every character of the output from the input:
// 1. With every line tagged, one Noul per pair of neighbouring lines: does this line continue a
//    sentence left unfinished on the line before? Lines that do are joined into blocks.
// 2. With every block tagged, per block: what kind of block it is (heading, paragraph, list item,
//    quote, code, callout), how deep a heading it is, whether it's a step in an ordered list, and
//    what kind of callout it is.
// Code then renders headings, lists (numbered when the items are steps), code fences, quotes and
// callouts. "Continues a sentence" works better than "same paragraph", which over-merges.
// Based on the approach in TypeSafe's "Structure recovery" cookbook.

import type { JevCall, JevClient } from "../jev.ts";
import { choice, noul } from "../questions.ts";
import { lowest, readChoice, readNoul } from "../readings.ts";
import { run } from "../task.ts";

export type BlockType = "heading" | "paragraph" | "list_item" | "quote" | "code" | "callout";

export interface Block {
  id: string;
  text: string;
  type: BlockType;
  confidence: number;
  level?: "title" | "section" | "subsection";
  step?: number;
  callout?: "note" | "tip" | "warning";
}

export interface Recovered {
  markdown: string;
  blocks: Block[];
  /** The least sure block type. */
  confidence: number;
}

const TYPES: Record<BlockType, string> = {
  heading: "A short title or label for the document or the section that follows, not a full sentence.",
  paragraph: "Running prose: one or more full sentences.",
  list_item: "One entry in a list of similar entries.",
  quote: "Words attributed to a person or another source.",
  code: "Code, a command, program output, or configuration meant to be copied exactly.",
  callout: "A note, tip or warning set apart from the flow for the reader to notice.",
};

export async function recoverStructure(jev: JevClient, text: string, opts: { log?: JevCall[] } = {}): Promise<Recovered> {
  // Pass 1: which line breaks are inside a sentence?
  const raw = text.split("\n");
  const lines: { text: string; blankBefore: boolean }[] = [];
  let blank = false;
  for (const l of raw) {
    if (!l.trim()) {
      blank = true;
      continue;
    }
    lines.push({ text: l.trim(), blankBefore: blank });
    blank = false;
  }
  const lid = (i: number) => `L${String(i).padStart(3, "0")}`;
  const tagged = lines.map((l, i) => `${l.blankBefore && i > 0 ? "\n" : ""}${lid(i)}| ${l.text}`).join("\n");
  const pairs = lines.map((l, i) => i).filter((i) => i > 0 && !lines[i]!.blankBefore);
  const joins = pairs.length
    ? await run(
        jev,
        {
          parts: { lines: tagged },
          questions: (at) =>
            Object.fromEntries(
              pairs.map((i) => [
                lid(i),
                noul(`In ${at("lines")}, line ${lid(i)} picks up mid-sentence, continuing a sentence left unfinished at the end of line ${lid(i - 1)}.`, {
                  true: "The line starts in the middle of a sentence begun on the line before; the line break split the sentence.",
                  false: "The line starts a new sentence, list entry, heading, or thought.",
                }),
              ]),
            ),
          read: (a) => Object.fromEntries(pairs.map((i) => [i, readNoul(a[lid(i)]).probability])),
        },
        { log: opts.log, title: "recoverStructure: joins" },
      )
    : {};
  const blocks: string[] = [];
  lines.forEach((l, i) => {
    const prev = blocks.length ? blocks[blocks.length - 1]! : "";
    const p = (joins as Record<number, number>)[i];
    const ended = /[.!?:;…]["')\]]?$/.test(prev);
    if (i > 0 && p !== undefined && p >= (ended ? 0.5 : 0.2)) blocks[blocks.length - 1] = `${prev} ${l.text}`;
    else blocks.push(l.text);
  });

  // Pass 2: what kind of block is each?
  const bid = (i: number) => `B${String(i).padStart(3, "0")}`;
  const btagged = blocks.map((b, i) => `${bid(i)}| ${b}`).join("\n");
  const read = await run(
    jev,
    {
      parts: { blocks: btagged },
      questions: (at) => {
        const qs: Record<string, ReturnType<typeof choice> | ReturnType<typeof noul>> = {};
        blocks.forEach((b, i) => {
          const id = bid(i);
          qs[`type.${id}`] = choice(`In ${at("blocks")}, what kind of content is block ${id}?`, TYPES);
          if (b.length <= 90)
            qs[`level.${id}`] = choice(`In ${at("blocks")}, if block ${id} is a heading, how high in the document's structure is it?`, {
              title: "The title of the whole document.",
              section: "A main section heading.",
              subsection: "A smaller heading inside a section.",
            });
          qs[`step.${id}`] = noul(`In ${at("blocks")}, block ${id} is one step in a sequence where the order of the steps matters.`);
          qs[`callout.${id}`] = choice(`In ${at("blocks")}, if block ${id} is set apart for the reader, what kind of aside is it?`, {
            note: "Neutral extra information.",
            tip: "A helpful suggestion or shortcut.",
            warning: "A caution about something that can go wrong.",
          });
        });
        return qs;
      },
      read: (a) =>
        blocks.map((b, i): Block => {
          const id = bid(i);
          const type = readChoice<BlockType>(a[`type.${id}`]);
          const block: Block = { id, text: b, type: type.value, confidence: type.confidence };
          if (type.value === "heading") block.level = (a[`level.${id}`] ? readChoice<"title" | "section" | "subsection">(a[`level.${id}`]).value : "section");
          block.step = readNoul(a[`step.${id}`]).probability;
          if (type.value === "callout") block.callout = readChoice<"note" | "tip" | "warning">(a[`callout.${id}`]).value;
          return block;
        }),
    },
    { log: opts.log, title: "recoverStructure: blocks" },
  );
  return { markdown: render(read), blocks: read, confidence: lowest(...read.map((b) => b.confidence)) };
}

/** Write blocks as Markdown. Exported so rendering can be tested without Jev. */
export function render(blocks: Block[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i]!;
    if (b.type === "list_item") {
      const run: Block[] = [];
      while (i < blocks.length && blocks[i]!.type === "list_item") run.push(blocks[i++]!);
      const numbered = run.reduce((s, x) => s + (x.step ?? 0), 0) / run.length >= 0.5;
      out.push(run.map((x, k) => `${numbered ? `${k + 1}.` : "-"} ${x.text}`).join("\n"));
      continue;
    }
    if (b.type === "code") {
      const run: Block[] = [];
      while (i < blocks.length && blocks[i]!.type === "code") run.push(blocks[i++]!);
      out.push(["```", ...run.map((x) => x.text), "```"].join("\n"));
      continue;
    }
    if (b.type === "heading") out.push(`${b.level === "title" ? "#" : b.level === "subsection" ? "###" : "##"} ${b.text}`);
    else if (b.type === "quote") out.push(`> ${b.text}`);
    else if (b.type === "callout") out.push(`> [!${(b.callout ?? "note").toUpperCase()}]\n> ${b.text}`);
    else out.push(b.text);
    i++;
  }
  return out.join("\n\n") + "\n";
}
