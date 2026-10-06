// Minimal CoNLL-U reader and writer. Format: https://universaldependencies.org/format.html
// We read basic trees over syntactic words: multiword-token lines ("1-2") are kept only so the
// original surface tokens can be shown, and empty nodes ("8.1", used by enhanced graphs) are skipped.

export interface ConlluWord {
  id: number;
  form: string;
  lemma: string;
  upos: string;
  xpos: string;
  feats: string;
  head: number;
  deprel: string;
  deps: string;
  misc: string;
}

export interface ConlluSentence {
  sentId: string;
  text: string;
  comments: string[];
  words: ConlluWord[];
  /** Multiword tokens as [first id, last id, surface form]. */
  multiwordTokens: [number, number, string][];
}

export function parseConllu(source: string): ConlluSentence[] {
  const out: ConlluSentence[] = [];
  let cur: ConlluSentence | undefined;
  const flush = () => {
    if (cur && cur.words.length > 0) out.push(cur);
    cur = undefined;
  };
  for (const raw of source.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.trim() === "") {
      flush();
      continue;
    }
    cur ??= { sentId: "", text: "", comments: [], words: [], multiwordTokens: [] };
    if (line.startsWith("#")) {
      cur.comments.push(line);
      const m = /^#\s*(sent_id|text)\s*=\s*(.*)$/.exec(line);
      if (m?.[1] === "sent_id") cur.sentId = m[2] ?? "";
      if (m?.[1] === "text") cur.text = m[2] ?? "";
      continue;
    }
    const cols = line.split("\t");
    if (cols.length !== 10) throw new Error(`bad CoNLL-U line (${cols.length} columns): ${line}`);
    const id = cols[0] as string;
    if (id.includes(".")) continue; // empty node
    const range = /^(\d+)-(\d+)$/.exec(id);
    if (range) {
      cur.multiwordTokens.push([Number(range[1]), Number(range[2]), cols[1] as string]);
      continue;
    }
    cur.words.push({
      id: Number(id),
      form: cols[1] as string,
      lemma: cols[2] as string,
      upos: cols[3] as string,
      xpos: cols[4] as string,
      feats: cols[5] as string,
      head: cols[6] === "_" ? -1 : Number(cols[6]),
      deprel: cols[7] as string,
      deps: cols[8] as string,
      misc: cols[9] as string,
    });
  }
  flush();
  return out;
}

export interface ConlluRow {
  form: string;
  upos?: string;
  head?: number;
  deprel?: string;
  misc?: string;
}

const clean = (s: string | undefined) => (s === undefined || s === "" ? "_" : s.replace(/[\t\n]/g, " "));

/** Write one sentence. Rows are words 1..n in order; unknown columns are written as "_". */
export function writeConllu(rows: ConlluRow[], meta: { sentId?: string; text?: string; comments?: string[] } = {}): string {
  const lines: string[] = [];
  if (meta.sentId) lines.push(`# sent_id = ${meta.sentId}`);
  if (meta.text !== undefined) lines.push(`# text = ${meta.text}`);
  for (const c of meta.comments ?? []) lines.push(c.startsWith("#") ? c : `# ${c}`);
  rows.forEach((r, i) => {
    lines.push(
      [i + 1, clean(r.form), "_", clean(r.upos), "_", "_", r.head === undefined ? "_" : r.head, clean(r.deprel), "_", clean(r.misc)].join("\t"),
    );
  });
  return lines.join("\n") + "\n";
}
