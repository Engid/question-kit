// The 17 Universal POS tags, grouped as UD groups them (open class, closed class, other):
// https://universaldependencies.org/u/pos/index.html
// Descriptions are our own short wording for the Choice options, with English examples.

export const UPOS = [
  "ADJ", "ADP", "ADV", "AUX", "CCONJ", "DET", "INTJ", "NOUN", "NUM",
  "PART", "PRON", "PROPN", "PUNCT", "SCONJ", "SYM", "VERB", "X",
] as const;
export type Upos = (typeof UPOS)[number];

export const UPOS_GROUPS = {
  open: ["NOUN", "PROPN", "VERB", "ADJ", "ADV", "INTJ"],
  closed: ["PRON", "DET", "ADP", "AUX", "CCONJ", "SCONJ", "PART", "NUM"],
  other: ["PUNCT", "SYM", "X"],
} as const satisfies Record<string, readonly Upos[]>;
export type UposGroup = keyof typeof UPOS_GROUPS;

export const UPOS_GROUP_DESCRIPTIONS: Record<UposGroup, string> = {
  open: "An open-class (content) word: a noun, proper noun, verb, adjective, adverb or interjection.",
  closed:
    "A closed-class (function) word: a pronoun, determiner, preposition, auxiliary, conjunction, particle or number.",
  other: "Not a word in the usual sense: punctuation, a symbol, or something unanalyzable.",
};

export const UPOS_DESCRIPTIONS: Record<Upos, string> = {
  NOUN: "Common noun: a person, place, thing or idea (\"book\", \"girl\", \"idea\").",
  PROPN: "Proper noun: the name of a specific person, place or organization (\"Mary\", \"Seattle\").",
  VERB: "Main verb: an action or state that is not just a helper (\"run\", \"want\", \"nominated\").",
  ADJ: "Adjective: describes a noun (\"large\", \"red\", \"federal\").",
  ADV: "Adverb: modifies a verb, adjective or clause (\"very\", \"quickly\", \"also\"); \"not\" is PART.",
  INTJ: "Interjection or filler: an exclamation or discourse word (\"uh\", \"oh\", \"yes\", \"please\").",
  PRON: "Pronoun: stands in for a noun (\"I\", \"you\", \"it\", \"who\", \"something\").",
  DET: "Determiner: comes before a noun to specify it (\"a\", \"the\", \"this\", \"some\", \"no\").",
  ADP: "Preposition or postposition: \"of\", \"in\", \"with\", \"from\".",
  AUX: "Auxiliary or copula: a helper verb or linking \"be\" (\"is\", \"can\", \"will\", \"have\" in \"have gone\").",
  CCONJ: "Coordinating conjunction: joins equals (\"and\", \"or\", \"but\").",
  SCONJ: "Subordinating conjunction: introduces a clause (\"if\", \"because\", \"that\", \"while\").",
  PART: "Particle: infinitive \"to\", negation \"not\"/\"n't\", possessive \"'s\".",
  NUM: "Number or numeral: \"two\", \"15\"; ordinals like \"first\" are ADJ.",
  PUNCT: "Punctuation mark: \".\", \",\", \"?\", \"-\".",
  SYM: "Symbol: \"$\", \"%\", \"+\", an emoji used as a word.",
  X: "Other: a foreign word, typo fragment, or anything that fits no other tag.",
};

export function uposGroupOf(tag: Upos): UposGroup {
  for (const [g, tags] of Object.entries(UPOS_GROUPS) as [UposGroup, readonly Upos[]][]) {
    if (tags.includes(tag)) return g;
  }
  return "other";
}

export function isUpos(s: string): s is Upos {
  return (UPOS as readonly string[]).includes(s);
}
