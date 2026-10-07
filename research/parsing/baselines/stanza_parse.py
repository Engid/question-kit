"""Parse a UD split with Stanza's EWT models, on the gold words, and write CoNLL-U with sent_ids.

This is the trained-parser reference point for the README: same treebank release, same split,
same gold tokenization as `bun run eval`. Score its output with the same TypeScript metrics:

    python research/parsing/baselines/stanza_parse.py data/ud/en_ewt-ud-dev.conllu research/parsing/baselines/out/stanza-ewt-dev.conllu
    bun run eval:score research/parsing/baselines/out/stanza-ewt-dev.conllu --name stanza-ewt

Notes:
- package="ewt" uses Stanza's models trained on UD English EWT (its default English package is
  "combined", trained on several treebanks). Which EWT release Stanza trained on is stated in
  Stanza's docs, not here; check before quoting a comparison.
- Gold words go in as pretokenized input, so tokenization errors don't count (the same setup as
  our evals; it is not the CoNLL 2018 raw-text setting).
"""

import sys
from pathlib import Path

import stanza


def read_gold(path):
    """Yield (sent_id, [forms]) over syntactic words, skipping multiword-token and empty-node lines."""
    sent_id, forms = None, []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            if forms:
                yield sent_id, forms
            sent_id, forms = None, []
        elif line.startswith("# sent_id"):
            sent_id = line.split("=", 1)[1].strip()
        elif not line.startswith("#"):
            cols = line.split("\t")
            if cols[0].isdigit():
                forms.append(cols[1])
    if forms:
        yield sent_id, forms


def main(gold_path, out_path):
    sents = list(read_gold(gold_path))
    stanza.download("en", package="ewt", processors="tokenize,pos,lemma,depparse")
    nlp = stanza.Pipeline(
        lang="en",
        package="ewt",
        processors="tokenize,pos,lemma,depparse",
        tokenize_pretokenized=True,
    )
    doc = nlp([forms for _, forms in sents])
    if len(doc.sentences) != len(sents):
        raise SystemExit(f"got {len(doc.sentences)} sentences back for {len(sents)} in")
    out = []
    for (sent_id, forms), sent in zip(sents, doc.sentences):
        if len(sent.words) != len(forms):
            raise SystemExit(f"{sent_id}: {len(sent.words)} words back for {len(forms)} in")
        out.append(f"# sent_id = {sent_id}")
        for w in sent.words:
            out.append("\t".join([str(w.id), w.text, w.lemma or "_", w.upos or "_", w.xpos or "_",
                                  w.feats or "_", str(w.head), w.deprel or "_", "_", "_"]))
        out.append("")
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"wrote {len(sents)} sentences to {out_path}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: python research/parsing/baselines/stanza_parse.py <gold.conllu> <out.conllu>")
    main(sys.argv[1], sys.argv[2])
