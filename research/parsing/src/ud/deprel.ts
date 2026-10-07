// The 37 universal dependency relations of UD v2: https://universaldependencies.org/u/dep/index.html
//
// UD's own table is a grid (core arguments / non-core dependents / nominal dependents ×
// nominals / clauses / modifier words / function words) plus small groups beside it. A
// hierarchical Choice needs a tree, so the groups below are OUR partition of that table:
// the three grid rows, with the function-word column pulled out as its own group, then
// coordination, the multiword relations, and everything else. `root` is never asked: the
// decoder decides which word attaches to the root.
// Descriptions are our own short wording.

export const DEPRELS = [
  "acl", "advcl", "advmod", "amod", "appos", "aux", "case", "cc", "ccomp", "clf", "compound",
  "conj", "cop", "csubj", "dep", "det", "discourse", "dislocated", "expl", "fixed", "flat",
  "goeswith", "iobj", "list", "mark", "nmod", "nsubj", "nummod", "obj", "obl", "orphan",
  "parataxis", "punct", "reparandum", "root", "vocative", "xcomp",
] as const;
export type Deprel = (typeof DEPRELS)[number];

export const DEPREL_GROUPS = {
  core: ["nsubj", "obj", "iobj", "csubj", "ccomp", "xcomp"],
  noncore: ["obl", "advmod", "advcl", "discourse", "vocative", "expl", "dislocated"],
  nominal: ["amod", "nummod", "nmod", "appos", "acl"],
  function: ["det", "case", "aux", "cop", "mark", "clf"],
  coordination: ["conj", "cc"],
  multiword: ["compound", "flat", "fixed"],
  other: ["punct", "parataxis", "list", "reparandum", "goeswith", "orphan", "dep"],
} as const satisfies Record<string, readonly Deprel[]>;
export type DeprelGroup = keyof typeof DEPREL_GROUPS;

/** Short names for the groups, used inside the fine questions. */
export const DEPREL_GROUP_LABELS: Record<DeprelGroup, string> = {
  core: "a core argument (subject, object or clausal complement)",
  noncore: "a non-core dependent of a predicate (oblique, adverbial, discourse word, vocative, expletive)",
  nominal: "a modifier of a noun",
  function: "a function word",
  coordination: "part of a coordination",
  multiword: "part of a multiword unit",
  other: "punctuation or a loose, repaired or unclassifiable dependent",
};

export const DEPREL_GROUP_DESCRIPTIONS: Record<DeprelGroup, string> = {
  core: "A core argument of a predicate: its subject, object, indirect object, or a clause in one of those roles.",
  noncore:
    "A non-core dependent of a predicate or clause: an oblique phrase (\"on Tuesday\", \"with a knife\" attached to a verb), an adverb, an adverbial clause, a discourse word or filler, a vocative.",
  nominal:
    "A modifier of a noun: an adjective, a number, another noun phrase (\"court in the area\"), an appositive, or a clause modifying the noun.",
  function:
    "A function word attached to the word it serves: a determiner, a preposition or case marker, an auxiliary, a copula, or a subordinator like \"to\", \"that\", \"if\".",
  coordination: "Part of a coordination: a later conjunct (\"cats\" in \"dogs and cats\") or the conjunction itself (\"and\").",
  multiword:
    "Part of a multiword unit: a noun-noun compound (\"phone call\"), a multiword name (\"Jennifer Anderson\"), or a fixed expression (\"because of\").",
  other:
    "Punctuation, a loosely attached clause or list item, a false start that is corrected, a word split by a typo, or something unclassifiable.",
};

export const DEPREL_DESCRIPTIONS: Record<Exclude<Deprel, "root">, string> = {
  nsubj: "nsubj: the nominal subject (\"I\" in \"I read a book\").",
  obj: "obj: the direct object (\"book\" in \"I read a book\").",
  iobj: "iobj: the indirect object, the recipient (\"me\" in \"give me a book\").",
  csubj: "csubj: a clause that is the subject (\"what she said\" in \"what she said is true\").",
  ccomp: "ccomp: a clause that is an object, with its own subject (\"you left\" in \"I think you left\").",
  xcomp: "xcomp: a clause complement whose subject comes from outside it (\"leave\" in \"I want to leave\").",
  obl: "obl: an oblique nominal attached to a verb, adjective or adverb (\"Tuesday\" in \"left on Tuesday\").",
  advmod: "advmod: an adverb modifying a predicate or modifier (\"very\", \"quickly\", \"also\").",
  advcl: "advcl: an adverbial clause (\"if it rains\" in \"we stay if it rains\").",
  discourse: "discourse: an interjection, filler or discourse marker (\"uh\", \"well\", \"oh\", \"please\").",
  vocative: "vocative: someone addressed by name (\"John\" in \"John, come here\").",
  expl: "expl: an expletive or dummy subject (\"there\" in \"there is a cat\", \"it\" in \"it rains\").",
  dislocated: "dislocated: a fronted or postposed element outside the clause (rare).",
  amod: "amod: an adjective modifying a noun (\"large\" in \"large house\").",
  nummod: "nummod: a number modifying a noun (\"two\" in \"two dogs\").",
  nmod: "nmod: a noun phrase modifying another noun (\"garden\" in \"a house with a garden\").",
  appos: "appos: an appositive renaming the noun (\"my friend\" in \"Sam, my friend, came\").",
  acl: "acl: a clause modifying a noun (\"retiring\" or \"that I ordered\" modifying a noun).",
  det: "det: a determiner (\"the\", \"a\", \"this\", \"no\").",
  case: "case: a preposition or case marker attached to its noun (\"of\", \"in\", \"with\").",
  aux: "aux: an auxiliary verb (\"will\", \"can\", \"have\", \"do\" helping a main verb).",
  cop: "cop: a copula linking a subject to a non-verbal predicate (\"is\" in \"she is happy\").",
  mark: "mark: a subordinator introducing a clause (\"to\" in \"to leave\", \"that\", \"if\", \"because\").",
  clf: "clf: a classifier (not used in English).",
  conj: "conj: a later conjunct, attached to the first conjunct (\"cats\" in \"dogs and cats\").",
  cc: "cc: a coordinating conjunction, attached to the conjunct after it (\"and\", \"or\", \"but\").",
  compound: "compound: a noun or particle in a compound (\"phone\" in \"phone call\", \"up\" in \"pick up\").",
  flat: "flat: a later part of a headless multiword name or date (\"Anderson\" in \"Jennifer Anderson\").",
  fixed: "fixed: a later part of a fixed grammatical expression (\"of\" in \"because of\").",
  punct: "punct: punctuation.",
  parataxis: "parataxis: a loosely juxtaposed clause, often after a colon, dash or comma splice.",
  list: "list: an item in a list of comparable items without coordination.",
  reparandum: "reparandum: a false start that the speaker corrects (\"wen-\" in \"we wen- went home\").",
  goeswith: "goeswith: a piece of a word split by a typo or a space.",
  orphan: "orphan: a dependent left behind when its head is elided.",
  dep: "dep: a dependency that fits no other relation.",
};

/** UD scoring compares only the universal part of a relation (`nmod:poss` → `nmod`). */
export function universalDeprel(deprel: string): string {
  const i = deprel.indexOf(":");
  return i < 0 ? deprel : deprel.slice(0, i);
}

export function deprelGroupOf(rel: string): DeprelGroup | undefined {
  for (const [g, rels] of Object.entries(DEPREL_GROUPS) as [DeprelGroup, readonly string[]][]) {
    if (rels.includes(rel)) return g;
  }
  return undefined;
}
