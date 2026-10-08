// callFunction: which function a request calls, and its arguments.
//
// From a description of each function and its parameters, it asks, all in one request:
// - which function (or none);
// - for a parameter that takes one of a set of values, a Choice whose options are those values;
// - for a parameter that takes several of a set, one Noul per value;
// - for an on/off flag, one Noul;
// - for an optional parameter, whether the request states it at all (otherwise its default stands,
//   instead of a confident guess);
// - for exact values and dates, the extractValue and extractDate questions.
// Every function's questions are asked, and only the chosen function's answers are read.
// Based on the approach in TypeSafe's "Function calling" cookbook.

import type { Json } from "../jev.ts";
import { choice, NONE, noul } from "../questions.ts";
import { lowest, readChoice, readNoul } from "../readings.ts";
import { q, Ref, type Text } from "../state.ts";
import { nest, place, type Task } from "../task.ts";
import { type ExtractDateOptions, extractDate } from "./extract-date.ts";
import { type ExtractValueOptions, extractValue } from "./extract-value.ts";

/**
 * A parameter. `about` is a noun phrase ("the size of the drink", "the order number"), except for
 * a flag, where it's a statement that's true when the flag is on ("The customer wants gift wrap.").
 */
export type Param =
  | { kind: "one"; about: string; values: Record<string, string>; default?: string }
  | { kind: "many"; about: string; values: Record<string, string>; default?: string[] }
  | { kind: "flag"; about: string; default?: boolean }
  | { kind: "value"; about: string; extract: Omit<ExtractValueOptions, "role" | "name">; default?: string | null }
  | { kind: "date"; about: string; date: Omit<ExtractDateOptions, "role" | "name">; default?: string | null };

export interface FunctionSpec {
  /** What the function does, in plain words. */
  does: string;
  params?: Record<string, Param>;
}

export interface CallFunctionOptions {
  /** Who's asking, for the question text: "the customer", "the user". Default "the request". */
  who?: string;
  name?: string;
}

export interface FunctionCall {
  /** The function called, or null for none. */
  name: string | null;
  args: Record<string, Json>;
  /** Parameters the request didn't state, left at their defaults. */
  omitted: string[];
  /** The least sure answer the call was built from. */
  confidence: number;
  /** Where that least sure answer came from. */
  weakest: string;
}

export function callFunction(text: string, functions: Record<string, FunctionSpec>, opts: CallFunctionOptions = {}): Task<FunctionCall> {
  const t = place(text, opts.name ?? "text");
  const who = opts.who ?? "the request";
  // Exact values and dates use their own methods' questions, pointed at the same text.
  const sub = (id: string, param: Param, r: Ref): Task<{ value?: string | null; date?: string | null; confidence: number }> | undefined => {
    if (param.kind === "value") return nest(id, extractValue(r, { ...param.extract, role: param.about, source: text }));
    if (param.kind === "date") return nest(id, extractDate(r, { ...param.date, role: param.about }));
    return undefined;
  };
  return {
    parts: t.parts,
    questions: (at) => {
      const r = t.ref(at);
      const qs: Record<string, ReturnType<typeof choice> | ReturnType<typeof noul>> = {
        fn: choice(
          q`What is ${who} in ${r} asking for?`,
          Object.fromEntries(Object.entries(functions).map(([fn, s]) => [fn, s.does])),
          { none: "None of these." },
        ),
      };
      for (const [fn, spec] of Object.entries(functions)) {
        for (const [p, param] of Object.entries(spec.params ?? {})) {
          const id = `${fn}.${p}`;
          if (param.kind === "one") {
            qs[id] = choice(q`In ${r}, what is ${param.about}?`, param.values);
            if (param.default !== undefined) qs[`${id}?`] = noul(q`${r} states ${param.about}.`);
          } else if (param.kind === "many") {
            for (const [v, desc] of Object.entries(param.values)) qs[`${id}.${v}`] = noul(q`As part of ${param.about}, ${r} asks for this: ${desc}`);
          } else if (param.kind === "flag") {
            qs[id] = noul(q`In ${r}: ${param.about}`);
          } else {
            Object.assign(qs, sub(id, param, r)!.questions(at));
            qs[`${id}?`] = noul(q`${r} gives ${param.about}.`);
          }
        }
      }
      return qs;
    },
    read: (a) => {
      const fnReading = readChoice(a.fn);
      const confs: [string, number][] = [["fn", fnReading.confidence]];
      if (fnReading.value === NONE) return { name: null, args: {}, omitted: [], confidence: fnReading.confidence, weakest: "fn" };
      const fn = fnReading.value;
      const args: Record<string, Json> = {};
      const omitted: string[] = [];
      for (const [p, param] of Object.entries(functions[fn]?.params ?? {})) {
        const id = `${fn}.${p}`;
        if (param.kind === "one") {
          const stated = a[`${id}?`];
          if (param.default !== undefined && stated && readNoul(stated).probability < 0.5) {
            args[p] = param.default;
            omitted.push(p);
            confs.push([`${id}?`, readNoul(stated).confidence]);
            continue;
          }
          const r = readChoice(a[id]);
          args[p] = r.value;
          confs.push([id, r.confidence]);
        } else if (param.kind === "many") {
          const chosen: string[] = [];
          for (const v of Object.keys(param.values)) {
            const r = readNoul(a[`${id}.${v}`]);
            if (r.value) chosen.push(v);
            confs.push([`${id}.${v}`, r.confidence]);
          }
          if (!chosen.length && param.default) {
            args[p] = param.default;
            omitted.push(p);
          } else args[p] = chosen;
        } else if (param.kind === "flag") {
          const r = readNoul(a[id]);
          args[p] = r.value;
          confs.push([id, r.confidence]);
        } else {
          const stated = readNoul(a[`${id}?`]);
          if (!stated.value) {
            args[p] = param.default ?? null;
            omitted.push(p);
            confs.push([`${id}?`, stated.confidence]);
            continue;
          }
          const result = sub(id, param, new Ref("text"))!.read(a);
          args[p] = param.kind === "value" ? (result.value ?? null) : (result.date ?? null);
          confs.push([id, result.confidence]);
        }
      }
      const [weakest, confidence] = confs.reduce((m, c) => (c[1] < m[1] ? c : m));
      return { name: fn, args, omitted, confidence: lowest(confidence), weakest };
    },
  };
}
