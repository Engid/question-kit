// search: which line of a document answers a query, and whether any line does.
//
// The document is sent with every line tagged (L000, L001…), and one request asks a Choice over the
// line tags plus a Noul: does any line answer the query at all? The ranking says where to look;
// the Noul says whether what's there answers it. Documents longer than one Choice holds are
// searched in two passes: first which block of lines, then which line inside it.
// Based on the approach in TypeSafe's "Line-by-line search" cookbook.

import type { SystemOneCall, SystemOneClient } from "../system-one.ts";
import { choice, NONE, noul } from "../questions.ts";
import { readChoice, readNoul } from "../readings.ts";
import type { Ref } from "../state.ts";
import { run } from "../task.ts";

/**
 * Is the answer in the document at all? Phrased against the usual failure: lines about the same
 * topic, or the same people and things, with the answer itself missing.
 */
const NO_LINE = "No line gives the answer.";

/**
 * "Which line answers it?", with a "none" option so a model is never made to pick a line when none
 * fits (some refuse the question instead). Whether there's an answer at all is still decided by
 * the "answered" question; the lines are ranked by their own probabilities.
 */
function lineQuestion(at: (name: string) => Ref, pool: { id: string }[]) {
  return choice(`Which line of ${at("document")}, if any, contains the answer to ${at("query")}?`, Object.fromEntries(pool.map((l) => [l.id, null])), { none: NO_LINE });
}

function answeredQuestion(at: (name: string) => Ref) {
  return noul(`Some line of ${at("document")} gives the answer to ${at("query")}: states it, or states a fact it follows from directly.`, {
    true: "At least one line gives the answer itself.",
    false: "The lines may be about the same topic, or mention the same people and things, but the answer to this question is not there.",
  });
}

export interface SearchOptions {
  /** Found when the "answered" probability is at least this. Default 0.7. */
  foundAt?: number;
  /**
   * Not found when it's under this. Default 0.7, the same as `foundAt`, so by default a question is
   * either answered or not found and "partly" needs a lower `absentBelow`. The cookbook's 0.35 was
   * set on one document; on questions written to look answerable, 0.7 caught most of them for one
   * lost answer in a hundred.
   */
  absentBelow?: number;
  /** Lines per block for long documents. Default 60. */
  block?: number;
  /**
   * After the lines are ranked, ask in a second request whether the top line itself gives the
   * answer, and take the lower of that and the whole-document answer as `answered`. Measured on
   * questions written to look answerable, it caught a few more of them, lost a few answers, and
   * cut confident wrong verdicts most of the way, at twice the requests; the default threshold
   * above did better without it. Default false.
   */
  confirm?: boolean;
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
        questions: (at) => ({ answered: answeredQuestion(at) }),
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
            `Which block of lines in ${at("document")}, if any, contains the answer to ${at("query")}?`,
            Object.fromEntries(blocks.map((b, i) => [`B${i}`, `Lines ${b[0]!.id} to ${b.at(-1)!.id}`])),
            { none: NO_LINE },
          ),
          answered: answeredQuestion(at),
        }),
        // The likeliest block, never "none": whether there's an answer at all is `answered`'s to say.
        read: (a) => ({ block: Number(readChoice(a.block).ranked.find(([id]) => id !== NONE)?.[0].slice(1) ?? 0), answered: readNoul(a.answered).probability }),
      },
      { log: opts.log, title: "search: block" },
    );
    pool = blocks[first.block] ?? tagged.slice(0, size);
    answered = first.answered;
    const second = await run(
      client,
      {
        parts: { document: doc, query },
        questions: (at) => ({ line: lineQuestion(at, pool) }),
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
        line: lineQuestion(at, pool),
        answered: answeredQuestion(at),
      }),
      read: (a) => ({ probs: readChoice(a.line).probabilities, answered: readNoul(a.answered).probability }),
    },
    { log: opts.log, title: "search" },
  );
  answered = res.answered;
  if (opts.confirm) {
    const top = Object.entries(res.probs).filter(([id]) => id !== NONE).sort((x, y) => y[1] - x[1])[0]?.[0];
    const line = pool.find((l) => l.id === top);
    if (line) {
      const check = await run(
        client,
        {
          parts: { line: line.text, query },
          questions: (at) => ({
            gives: noul(`${at("line")} gives the answer to ${at("query")}: it states the answer, or a fact it follows from directly.`, {
              true: "The answer is in this line.",
              false: "The line is about the same topic, or mentions the same people and things, but the answer to this question is not in it.",
            }),
          }),
          read: (a) => readNoul(a.gives).probability,
        },
        { log: opts.log, title: "search: confirm" },
      );
      answered = Math.min(answered, check);
    }
  }
  return result(pool, res.probs, answered, opts);
}

function result(pool: { id: string; line: number; text: string }[], probs: Record<string, number>, answered: number, opts: SearchOptions): SearchResult {
  const lines = pool
    .map((l) => ({ ...l, probability: probs[l.id] ?? 0 }))
    .sort((x, y) => y.probability - x.probability)
    .slice(0, opts.top ?? 5);
  const verdict = answered >= (opts.foundAt ?? 0.7) ? "answered" : answered < (opts.absentBelow ?? 0.7) ? "not found" : "partly";
  return { verdict, answered, lines };
}
