// Text rendering shared by `bun run explain` and `bun run eval`: bars, answer lines and trees.

import type { CallRecord, QuestionMeta } from "../src/calls.ts";
import type { Gold } from "../src/gold.ts";
import type { ChoiceAnswer, NoulAnswer, Question } from "../src/jev/types.ts";
import { QUESTION_SETS } from "../src/question-sets/index.ts";
import type { ParseResult } from "../src/types.ts";
import { universalDeprel } from "../src/ud/deprel.ts";

/** A horizontal bar for a probability: width characters at p = 1. */
export function bar(p: number, width = 12): string {
  const eighths = Math.round(Math.max(0, Math.min(1, p)) * width * 8);
  const full = Math.floor(eighths / 8);
  const part = eighths % 8;
  return "█".repeat(full) + (part ? (["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"][part] as string) : "");
}

export function pct(x: number): string {
  return `${(100 * x).toFixed(1)}%`;
}

const quote = (s: string) => `"${s}"`;

/** What an option means, in words: "across", root, [the red ball], or the option id itself. */
export function optionLabel(meta: QuestionMeta | undefined, option: string, words: string[]): string {
  const m = meta?.options?.[option];
  if (m === undefined) return option;
  if (typeof m === "number") return m === 0 ? "root" : quote(words[m - 1] ?? "?");
  if (Array.isArray(m)) return `[${m.map((id) => words[id - 1]).join(" ")}]`;
  return m;
}

/** What a question is about, in words. */
export function subjectLabel(meta: QuestionMeta | undefined, words: string[]): string {
  if (!meta) return "?";
  if (meta.pair) return `${quote(words[meta.pair[0] - 1] ?? "?")} + ${quote(words[meta.pair[1] - 1] ?? "?")}`;
  if (meta.word !== undefined) {
    const w = quote(words[meta.word - 1] ?? "?");
    return meta.head !== undefined ? `${w} → ${meta.head === 0 ? "root" : quote(words[meta.head - 1] ?? "?")}` : w;
  }
  if (meta.phrase) return `[${meta.phrase.map((id) => words[id - 1]).join(" ")}]`;
  return "?";
}

/** Replace `words.wN` with "word" so a question reads as plain English. */
export function resolvePaths(text: string, words: string[], phrases?: Record<string, string>): string {
  return text
    .replace(/`words\.w(\d+)`/g, (_, n) => `"${words[Number(n) - 1] ?? "?"}"`)
    .replace(/`phrases\.(p\d+)`/g, (_, p) => `[${phrases?.[p] ?? p}]`)
    .replace(/`sentence`/g, "the sentence");
}

export interface AnswerLine {
  subject: string;
  ranked: { label: string; p: number }[];
  verdict: string;
}

/** One question's answer: the top options with probabilities, and ✓/✗ against the treebank. */
export function answerLine(id: string, q: Question, call: CallRecord, words: string[], gold?: Gold): AnswerLine {
  const meta = call.meta[id];
  const a = call.response.answers[id];
  let ranked: { label: string; p: number }[] = [];
  let top: string | boolean | undefined;
  if (q.type === "noul" && a) {
    const p = (a as NoulAnswer).noul;
    ranked = [
      { label: "yes", p },
      { label: "no", p: 1 - p },
    ].sort((x, y) => y.p - x.p);
    top = p >= 0.5;
  } else if (a) {
    const probs = Object.entries((a as ChoiceAnswer).probabilities).sort((x, y) => y[1] - x[1]);
    ranked = probs.map(([opt, p]) => ({ label: optionLabel(meta, opt, words), p }));
    top = probs[0]?.[0];
  }
  let verdict = "";
  if (gold && meta) {
    const right = QUESTION_SETS[meta.set]?.expected(meta, gold);
    if (right === undefined) verdict = "· no right answer offered";
    else if (right === top) verdict = "✓";
    else verdict = `✗ treebank: ${typeof right === "boolean" ? (right ? "yes" : "no") : optionLabel(meta, right, words)}`;
  }
  return { subject: subjectLabel(meta, words), ranked, verdict };
}

export function formatAnswerLines(lines: AnswerLine[], topK = 3): string[] {
  const w = Math.max(...lines.map((l) => l.subject.length), 4);
  return lines.map((l) => {
    const [first, ...rest] = l.ranked;
    if (!first) return `${l.subject.padEnd(w)}  (no answer)`;
    const head = `${first.label} ${first.p.toFixed(2)} ${bar(first.p, 10)}`;
    const others = rest
      .slice(0, topK - 1)
      .filter((r) => r.p >= 0.005)
      .map((r) => `${r.label} ${r.p.toFixed(2)}`)
      .join(" · ");
    return `${l.subject.padEnd(w)}  → ${head.padEnd(30)}${others ? `  ${others}` : ""}${l.verdict ? `   ${l.verdict}` : ""}`;
  });
}

/**
 * The parse as an indented tree from the main word down. With gold, wrong attachments are marked
 * with the word the treebank attaches them to.
 */
export function renderTree(r: ParseResult, gold?: Gold): string[] {
  const n = r.tokens.length;
  const children = new Map<number, number[]>();
  for (const e of r.edges) children.set(e.head, [...(children.get(e.head) ?? []), e.dep]);
  const lines: string[] = [];
  const label = (d: number) => {
    const t = r.tokens[d - 1]!;
    const e = r.edges[d - 1]!;
    let s = `${t.form}  ${t.upos} · ${e.deprel}`;
    if (e.by === "cleanup") s += "  (moved by cleanup)";
    else if (e.by === "tree") s += "  (tree builder overrode Jev's top answer)";
    if (gold) {
      const g = gold.words[d - 1]!;
      if (g.head !== e.head) s += `   ✗ treebank attaches it to ${g.head === 0 ? "root" : `"${gold.words[g.head - 1]?.form}"`}`;
      else if (universalDeprel(e.deprel) !== g.deprel) s += `   ~ treebank relationship: ${g.deprel}`;
    }
    return s;
  };
  const walk = (d: number, prefix: string, last: boolean, top: boolean) => {
    lines.push(top ? label(d) : `${prefix}${last ? "└─ " : "├─ "}${label(d)}`);
    const kids = (children.get(d) ?? []).sort((a, b) => a - b);
    kids.forEach((k, i) => walk(k, top ? "" : prefix + (last ? "   " : "│  "), i === kids.length - 1, false));
  };
  const roots = (children.get(0) ?? []).sort((a, b) => a - b);
  for (const root of roots) walk(root, "", true, true);
  if (lines.length < n) lines.push(`(${n - lines.length} words not reachable from the main word: the attachments contain a loop)`);
  return lines;
}
