// A test double that answers head-selection questions from a gold tree. It checks the plumbing:
// with a perfect scorer, the whole pipeline (questions → answers → decode → labels → CoNLL-U)
// must reproduce the gold tree. It is NOT a model and its numbers say nothing about Jev.

import { DEPREL_GROUPS } from "../ud/deprel.ts";
import { UPOS_GROUPS } from "../ud/upos.ts";
import { universalDeprel } from "../ud/deprel.ts";
import { MockJevClient, peakedChoice } from "./mock.ts";

export interface GoldWord {
  upos: string;
  head: number;
  deprel: string;
}

export function oracleClient(gold: GoldWord[], mass = 0.9): MockJevClient {
  return new MockJevClient((id, q) => {
    if (q.type !== "choice") return undefined;
    const options = Object.keys(q.criteria);
    const m = /^(pos|head|rel)_w(\d+)(?:_(\w+))?$/.exec(id);
    if (!m) return undefined;
    const g = gold[Number(m[2]) - 1];
    if (!g) return undefined;
    const kind = m[1];
    const sub = m[3];
    const rel = universalDeprel(g.deprel);
    if (kind === "pos") {
      if (sub === undefined) return peakedChoice(options, g.upos, mass);
      if (sub === "group") {
        const group = Object.entries(UPOS_GROUPS).find(([, tags]) => (tags as readonly string[]).includes(g.upos))?.[0];
        return peakedChoice(options, group, mass);
      }
      return peakedChoice(options, g.upos, mass);
    }
    if (kind === "head") return peakedChoice(options, g.head === 0 ? "root" : `w${g.head}`, mass);
    if (sub === "group") {
      const group = Object.entries(DEPREL_GROUPS).find(([, rels]) => (rels as readonly string[]).includes(rel))?.[0];
      return peakedChoice(options, group, mass);
    }
    return peakedChoice(options, rel, mass);
  });
}
