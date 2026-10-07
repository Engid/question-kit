// A small rule tokenizer that follows UD English EWT conventions closely enough for the demo and the
// coffee example: punctuation split off, hyphenated words split ("15-year" → "15 - year"), and
// clitics split as EWT splits them ("don't" → "do n't", "can't" → "ca n't", "I'm" → "I 'm").
// Evals use the treebank's gold words instead, so tokenizer errors never reach parser scores.

export interface Token {
  form: string;
  /** False when the next token followed with no space (CoNLL-U `SpaceAfter=No`). */
  spaceAfter: boolean;
}

const ABBREVIATIONS = new Set([
  "mr.", "mrs.", "ms.", "dr.", "st.", "jr.", "sr.", "vs.", "etc.", "e.g.", "i.e.", "u.s.", "u.k.",
  "a.m.", "p.m.", "inc.", "co.", "corp.", "ltd.", "no.", "approx.",
]);

const LEADING = /^([("'“‘\[{$#¿¡]|\.\.\.)/;
const TRAILING = /(\.\.\.|…|[.,!?;:)"'”’\]}%])$/;
const CLITIC = /^(.+?)(n't|n’t|'s|’s|'re|’re|'ve|’ve|'ll|’ll|'d|’d|'m|’m)$/i;
const SPECIAL_SPLITS: Record<string, [string, string]> = {
  cannot: ["can", "not"],
  gonna: ["gon", "na"],
  wanna: ["wan", "na"],
  gotta: ["got", "ta"],
};

function splitWord(word: string): string[] {
  const lead: string[] = [];
  const trail: string[] = [];
  let w = word;
  // Peel leading punctuation.
  for (let m = LEADING.exec(w); m && w.length > m[0].length; m = LEADING.exec(w)) {
    lead.push(m[0]);
    w = w.slice(m[0].length);
  }
  // Peel trailing punctuation, keeping abbreviations and initials intact.
  for (let m = TRAILING.exec(w); m && w.length > m[0].length; m = TRAILING.exec(w)) {
    if (m[0] === "." && (ABBREVIATIONS.has(w.toLowerCase()) || /^([A-Za-z]\.)+$/.test(w))) break;
    trail.unshift(m[0]);
    w = w.slice(0, w.length - m[0].length);
  }
  const core: string[] = [];
  const special = SPECIAL_SPLITS[w.toLowerCase()];
  if (special) {
    const cut = special[0].length;
    core.push(w.slice(0, cut), w.slice(cut));
  } else if (/^(https?:\/\/|www\.)/i.test(w) || /^\S+@\S+\.\S+$/.test(w)) {
    core.push(w);
  } else {
    const c = CLITIC.exec(w);
    if (c && /n[’']t$/i.test(w) && w.length > 3) {
      // n't: "don't" → "do" + "n't"; "can't" → "ca" + "n't"; "won't" → "wo" + "n't".
      core.push(w.slice(0, -3), w.slice(-3));
    } else if (c && c[1] && /[A-Za-z]$/.test(c[1])) {
      core.push(c[1], c[2] as string);
    } else {
      core.push(w);
    }
  }
  // Split internal hyphens between alphanumerics ("15-year" → "15", "-", "year").
  const out: string[] = [];
  for (const piece of core) {
    if (/^[\p{L}\p{N}]+(-[\p{L}\p{N}]+)+$/u.test(piece)) {
      piece.split(/(-)/).forEach((p) => p && out.push(p));
    } else {
      out.push(piece);
    }
  }
  return [...lead, ...out, ...trail];
}

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const m of text.matchAll(/\S+/g)) {
    const pieces = splitWord(m[0]);
    pieces.forEach((form, i) => tokens.push({ form, spaceAfter: i === pieces.length - 1 }));
  }
  const last = tokens.at(-1);
  if (last) last.spaceAfter = false;
  return tokens;
}
