// search: which line of a document answers a query, and whether any line does.
//
// The document is sent with every line tagged (L000, L001…), and one request asks a Choice over the
// line tags plus a Noul: does any line answer the query at all? The ranking says where to look;
// the Noul says whether what's there answers it. Documents longer than one Choice holds are
// searched in two passes: first which block of lines, then which line inside it.
// Based on the approach in TypeSafe's "Line-by-line search" cookbook.

import type { SystemOneCall, SystemOneClient } from "../system-one.ts";
import { choice, noul } from "../questions.ts";
import { readChoice, readNoul } from "../readings.ts";
import { run } from "../task.ts";

export interface SearchOptions {
  /** Found when the "answered" probability is at least this. Default 0.7. */
  foundAt?: number;
  /** Not found when it's under this. Default 0.35. */
  absentBelow?: number;
  /** Lines per block for long documents. Default 60. */
  block?: number;
  /** How many lines to return. Default 5. */
  top?: number;
  log?: SystemOneCall[];
}

export interface SearchResult {
  /** "answered", "partly" or "not found", from the existence check. */
  verdict: "answered" | "partly" | "not found";
  /** Probability that some line answers the query. */
  answered: number;
  /** The most likely lines, best first. */
  lines: { id: string; line: number; text: string; probability: number }[];
}

const MAX_LINES = 240;

export async function search(client: SystemOneClient, document: string | string[], query: string, opts: SearchOptions = {}): Promise<SearchResult> {
  const all = (Array.isArray(document) ? document : document.split("\n")).map((text, line) => ({ text, line })).filter((l) => l.text.trim());
  const tag = (i: number) => `L${String(i).padStart(3, "0")}`;
  const tagged = all.map((l, i) => ({ ...l, id: tag(i) }));
  const doc = tagged.map((l) => `${l.id}| ${l.text}`).join("\n");

  let pool = tagged;
  let answered: number;
  if (tagged.length < 2) {
    // A Choice needs two options; with one line, only the existence check matters.
    const only = await run(
      client,
      {
        parts: { document: doc, query },
        questions: (at) => ({ answered: noul(`Some line of ${at("document")} states or directly implies the answer to ${at("query")}.`) }),
        read: (a) => readNoul(a.answered).probability,
      },
      { log: opts.log, title: "search" },
    );
    return result(tagged, Object.fromEntries(tagged.map((l) => [l.id, 1])), only, opts);
  }
  if (tagged.length > MAX_LINES) {
    const size = opts.block ?? 60;
    const blocks: (typeof tagged)[] = [];
    for (let i = 0; i < tagged.length; i += size) blocks.push(tagged.slice(i, i + size));
    const first = await run(
      client,
      {
        parts: { document: doc, query },
        questions: (at) => ({
          block: choice(
            `Which block of lines in ${at("document")} contains the answer to ${at("query")}?`,
            Object.fromEntries(blocks.map((b, i) => [`B${i}`, `Lines ${b[0]!.id} to ${b.at(-1)!.id}`])),
          ),
          answered: noul(`Some line of ${at("document")} states or directly implies the answer to ${at("query")}.`),
        }),
        read: (a) => ({ block: Number(readChoice(a.block).value.slice(1)), answered: readNoul(a.answered).probability }),
      },
      { log: opts.log, title: "search: block" },
    );
    pool = blocks[first.block] ?? tagged.slice(0, size);
    answered = first.answered;
    const second = await run(
      client,
      {
        parts: { document: doc, query },
        questions: (at) => ({ line: choice(`Which line of ${at("document")} contains the answer to ${at("query")}?`, Object.fromEntries(pool.map((l) => [l.id, null]))) }),
        read: (a) => readChoice(a.line).probabilities,
      },
      { log: opts.log, title: "search: line" },
    );
    return result(pool, second, answered, opts);
  }
  const res = await run(
    client,
    {
      parts: { document: doc, query },
      questions: (at) => ({
        line: choice(`Which line of ${at("document")} contains the answer to ${at("query")}?`, Object.fromEntries(pool.map((l) => [l.id, null]))),
        answered: noul(`Some line of ${at("document")} states or directly implies the answer to ${at("query")}.`, {
          true: "At least one line states or directly implies the answer.",
          false: "No line addresses this.",
        }),
      }),
      read: (a) => ({ probs: readChoice(a.line).probabilities, answered: readNoul(a.answered).probability }),
    },
    { log: opts.log, title: "search" },
  );
  answered = res.answered;
  return result(pool, res.probs, answered, opts);
}

function result(pool: { id: string; line: number; text: string }[], probs: Record<string, number>, answered: number, opts: SearchOptions): SearchResult {
  const lines = pool
    .map((l) => ({ ...l, probability: probs[l.id] ?? 0 }))
    .sort((x, y) => y.probability - x.probability)
    .slice(0, opts.top ?? 5);
  const verdict = answered >= (opts.foundAt ?? 0.7) ? "answered" : answered < (opts.absentBelow ?? 0.35) ? "not found" : "partly";
  return { verdict, answered, lines };
}
