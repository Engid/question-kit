// pickOne: which one of many options is wanted, or none of them.
//
// Two requests. The first ranks every option with one Choice and asks "gate" questions about
// whether anything should be picked at all. If the gates pass, the second looks closely at the top
// few: a Choice over just those, with fuller descriptions, and one "does this fit?" Noul per
// candidate. The Choice settles which one; the gates and the fit checks settle whether to pick any.
// Use it for intents, for "which of your orders do you mean?", or any catalog.
// Based on the approach in TypeSafe's "Skill suggestion" cookbook.

import { type SystemOneCall, type SystemOneClient, type Json } from "../system-one.ts";
import { choice, NONE, noul } from "../questions.ts";
import { readChoice, readNoul } from "../readings.ts";
import { q, type Text } from "../state.ts";
import { place, run, type Task } from "../task.ts";

export interface Candidate {
  /** A short description, used to rank all the options. */
  short: string;
  /** A fuller description, used when comparing the shortlist. Defaults to `short`. */
  full?: string | Record<string, Json>;
}

export interface PickOneOptions {
  /** What's being picked, for the question text: "intent", "order", "skill". Default "option". */
  noun?: string;
  /**
   * Statements that are true when something should be picked at all, written about the text.
   * Default: one, "This asks for something one of the listed options covers."
   */
  gates?: string[];
  /** Pick nothing if the gates' average is under this. Default 0.3. */
  gateBelow?: number;
  /** How many top options to look at closely. Default 3. */
  shortlist?: number;
  /** Pick nothing if no candidate's "fits" is at least this. Default 0.3. */
  fitsBelow?: number;
  /** Options per Choice in the first request; bigger catalogs are split into several Choices. Default 240. */
  chunk?: number;
  name?: string;
  log?: SystemOneCall[];
}

export interface Picked<K extends string> {
  /** The option picked, or null for none. */
  value: K | null;
  /** Why nothing was picked, when nothing was. */
  reason?: "gate" | "no-fit";
  /** Probability of the pick in the close-look Choice. */
  probability: number;
  confidence: number;
  /** Average of the gate questions (probability something should be picked). */
  gate: number;
  /** The shortlist, best first, with each candidate's "fits" probability. */
  shortlist: { id: K; rank: number; fits: number }[];
}

export async function pickOne<K extends string>(client: SystemOneClient, text: Text, catalog: Record<K, Candidate>, opts: PickOneOptions = {}): Promise<Picked<K>> {
  const noun = opts.noun ?? "option";
  const gates = opts.gates ?? [`This asks for something one of the listed ${noun}s covers.`];
  const ids = Object.keys(catalog) as K[];
  const chunk = opts.chunk ?? 240;
  const t = place(text, opts.name ?? "text");

  // Request 1: rank everything, and ask whether anything should be picked.
  const chunks: K[][] = [];
  for (let i = 0; i < ids.length; i += chunk) chunks.push(ids.slice(i, i + chunk));
  const wide: Task<{ ranked: [K, number][]; gate: number }> = {
    parts: t.parts,
    questions: (at) => {
      const r = t.ref(at);
      const qs: Record<string, ReturnType<typeof choice> | ReturnType<typeof noul>> = {};
      chunks.forEach((c, i) => {
        qs[`rank${i}`] = choice(
          q`Which of these ${noun}s, if any, is the one ${r} asks for?`,
          Object.fromEntries(c.map((id) => [id, catalog[id].short])),
          { none: `None of these ${noun}s.` },
        );
      });
      gates.forEach((g, i) => {
        qs[`gate${i}`] = noul(q`About ${r}: ${g}`);
      });
      return qs;
    },
    read: (a) => {
      const ranked: [K, number][] = [];
      chunks.forEach((_, i) => {
        for (const [id, p] of readChoice(a[`rank${i}`]).ranked) if (id !== NONE) ranked.push([id as K, p]);
      });
      ranked.sort((x, y) => y[1] - x[1]);
      const gate = gates.reduce((s, _, i) => s + readNoul(a[`gate${i}`]).probability, 0) / gates.length;
      return { ranked, gate };
    },
  };
  const first = await run(client, wide, { log: opts.log, title: "pickOne: rank" });
  const top = first.ranked.slice(0, opts.shortlist ?? 3).map(([id]) => id);
  if (first.gate < (opts.gateBelow ?? 0.3) || top.length === 0) {
    return { value: null, reason: "gate", probability: 0, confidence: 0, gate: first.gate, shortlist: top.map((id, i) => ({ id, rank: i + 1, fits: 0 })) };
  }

  // Request 2: look closely at the shortlist.
  const close: Task<{ pick: K; probability: number; confidence: number; fits: Record<string, number> }> = {
    parts: t.parts,
    questions: (at) => {
      const r = t.ref(at);
      const qs: Record<string, ReturnType<typeof choice> | ReturnType<typeof noul>> = {
        pick: choice(
          q`One of these ${noun}s is the one ${r} asks for. Which one? Go by what each one covers, not just its name.`,
          Object.fromEntries(top.map((id) => [id, catalog[id].full ?? catalog[id].short])),
        ),
      };
      top.forEach((id, i) => {
        const c = catalog[id];
        qs[`fits${i}`] = noul({ question: `Does the ${noun} "${id}" cover the specific thing ${r} asks for?`, [noun]: c.full ?? c.short });
      });
      return qs;
    },
    read: (a) => {
      const pick = readChoice<K>(a.pick);
      return { pick: pick.value, probability: pick.probability, confidence: pick.confidence, fits: Object.fromEntries(top.map((id, i) => [id, readNoul(a[`fits${i}`]).probability])) };
    },
  };
  if (top.length === 1) {
    // A Choice needs two options; with one candidate, the fit check alone decides.
    const only = top[0]!;
    const fit = await run(client, {
      parts: t.parts,
      questions: (at) => ({ fits0: noul({ question: `Does the ${noun} "${only}" cover the specific thing ${t.ref(at)} asks for?`, [noun]: catalog[only].full ?? catalog[only].short }) }),
      read: (a) => readNoul(a.fits0).probability,
    }, { log: opts.log, title: "pickOne: check" });
    const ok = fit >= (opts.fitsBelow ?? 0.3);
    return { value: ok ? only : null, ...(ok ? {} : { reason: "no-fit" as const }), probability: fit, confidence: Math.abs(2 * fit - 1), gate: first.gate, shortlist: [{ id: only, rank: 1, fits: fit }] };
  }
  const second = await run(client, close, { log: opts.log, title: "pickOne: close look" });
  const shortlist = top.map((id, i) => ({ id, rank: i + 1, fits: second.fits[id] ?? 0 }));
  const bestFit = Math.max(...shortlist.map((s) => s.fits));
  if (bestFit < (opts.fitsBelow ?? 0.3)) return { value: null, reason: "no-fit", probability: second.probability, confidence: second.confidence, gate: first.gate, shortlist };
  return { value: second.pick, probability: second.probability, confidence: second.confidence, gate: first.gate, shortlist };
}

/**
 * A catalog from records, for "which of your orders?": describe(record) gives each one's short
 * description, and full(record) (optional) its fuller one.
 */
export function fromRecords<R>(records: R[], id: (r: R) => string, describe: (r: R) => string, full?: (r: R) => string | Record<string, Json>): Record<string, Candidate> {
  return Object.fromEntries(records.map((r) => [id(r), { short: describe(r), ...(full ? { full: full(r) } : {}) }]));
}
