// Naming the parts of the state, and pointing questions at them.
//
// TypeSafe's guidance: give the state named parts, and when a question is about one of them, name it
// in the instructions with its dotted path in backticks (https://docs.typesafe.ai/concepts/state.md).
// A `Ref` is such a path. Interpolating one into `q`…`` writes it as `path`, so question text and
// state can't drift apart, and the pre-send checks can confirm every path exists.

import type { Entry, Json } from "./jev.ts";

/** A dotted path to a part of the state, written in questions as `path`. */
export class Ref {
  constructor(readonly path: string) {}
  /** A part inside this one: ref("orders").at("o2") is `orders.o2`. */
  at(key: string | number): Ref {
    return new Ref(this.path ? `${this.path}.${key}` : String(key));
  }
  toString(): string {
    return `\`${this.path}\``;
  }
}

export function ref(path: string): Ref {
  return new Ref(path);
}

/** Text or a reference to text already in the state. Methods copy text into their own part, or point at the reference. */
export type Text = string | Ref;

/**
 * Write question text with references: q`Which order in ${orders} is ${message} about?` gives
 * "Which order in `orders` is `message` about?".
 */
export function q(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = strings[0] ?? "";
  values.forEach((v, i) => {
    out += String(v) + (strings[i + 1] ?? "");
  });
  return out;
}

/**
 * A list as an object with addressable keys, so questions can point at one item:
 * keyed(["a", "b"], "o") is { o1: "a", o2: "b" }.
 */
export function keyed<T extends Json>(items: T[], prefix: string): Record<string, T> {
  return Object.fromEntries(items.map((item, i) => [`${prefix}${i + 1}`, item]));
}

/** Every dotted path that exists in a state (objects only; arrays by index). */
export function paths(state: Entry): Set<string> {
  const out = new Set<string>();
  const walk = (v: Json, prefix: string) => {
    if (prefix) out.add(prefix);
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, prefix ? `${prefix}.${i}` : String(i)));
    else if (v !== null && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, prefix ? `${prefix}.${k}` : k);
  };
  if (state !== null && typeof state === "object") walk(state as Json, "");
  return out;
}

/** The backticked paths a piece of question text refers to. */
export function referencedPaths(text: Entry): string[] {
  const s = typeof text === "string" ? text : JSON.stringify(text ?? "");
  return [...s.matchAll(/`([A-Za-z_][\w-]*(?:\.[\w-]+)*)`/g)].map((m) => m[1]!);
}
