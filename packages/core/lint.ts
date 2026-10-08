// Checks run on a request before it's sent.
//
// Errors stop the request; warnings are returned for you to read. Each rule comes from TypeSafe's
// guidance:
// - every question needs its full text in `instructions`, because ids aren't sent
//   (https://docs.typesafe.ai/primitives.md);
// - a Choice holds at most 255 options (https://docs.typesafe.ai/primitives/choice.md);
// - a backticked path must exist in the state (https://docs.typesafe.ai/concepts/state.md);
// - one condition per Noul, phrased so that yes means the thing
//   (https://docs.typesafe.ai/primitives/noul.md);
// - leave arithmetic, counting and dates to code
//   (https://docs.typesafe.ai/model-jaggedness/jev-1.13.md).

import { type Entry, MAX_CHOICE_OPTIONS, type Question } from "./jev.ts";
import { paths, referencedPaths } from "./state.ts";

export interface Problem {
  question: string;
  level: "error" | "warning";
  message: string;
}

export function lint(state: Entry, questions: Record<string, Question>): Problem[] {
  const out: Problem[] = [];
  const known = paths(state);
  const isText = typeof state === "string";
  for (const [id, qn] of Object.entries(questions)) {
    const err = (message: string) => out.push({ question: id, level: "error", message });
    const warn = (message: string) => out.push({ question: id, level: "warning", message });
    const text = typeof qn.instructions === "string" ? qn.instructions : JSON.stringify(qn.instructions ?? "");
    if (!text.trim() || text === '""' || text === "null") err("no instructions: the question id isn't sent, so the instructions must hold the whole question");
    if (!isText) {
      // Structured instructions can name their own keys too ("Does the `value` fit the `field`?").
      const own = qn.instructions !== null && typeof qn.instructions === "object" ? paths(qn.instructions) : new Set<string>();
      for (const p of referencedPaths(qn.instructions)) if (!known.has(p) && !own.has(p)) err(`refers to \`${p}\`, which isn't in the state`);
    }
    if (qn.type === "choice") {
      const n = Object.keys(qn.criteria).length;
      if (n < 2) err(`a Choice needs at least 2 options (has ${n})`);
      if (n > MAX_CHOICE_OPTIONS) err(`a Choice holds at most ${MAX_CHOICE_OPTIONS} options (has ${n}); shortlist or split it first`);
    }
    if (qn.type === "score" && qn.criteria.length < 2) err("a Score needs at least 2 levels");
    if (qn.type === "noul") {
      const plain = text.toLowerCase();
      if (/\bfree of\b|\bdoes not\b|\bdoesn't\b|\bisn't\b|\bis not\b/.test(plain)) warn("phrased in the negative; Nouls read best when yes means the thing you're looking for");
      if (/\?\s*\S.*\?/.test(text)) warn("asks more than one question; split it and combine the answers in code");
    }
    if (/\bhow many\b|\bcount\b|\bsum of\b|\bdays between\b/i.test(text)) warn("looks like arithmetic or counting; do that in code and ask one question per item");
  }
  return out;
}

export class LintError extends Error {
  constructor(readonly problems: Problem[]) {
    super(`request not sent:\n${problems.map((p) => `  ${p.question}: ${p.message}`).join("\n")}`);
  }
}
