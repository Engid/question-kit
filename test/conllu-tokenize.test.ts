import { describe, expect, test } from "bun:test";
import { composeTwoLevel, choiceConfidence, noulConfidence, pathScore, separation } from "../research/lab/jev/confidence.ts";
import { tokenize } from "../research/parsing/src/tokenize.ts";
import { parseConllu, writeConllu } from "../research/parsing/src/ud/conllu.ts";
import { universalDeprel } from "../research/parsing/src/ud/deprel.ts";

describe("CoNLL-U", () => {
  test("skips empty nodes and keeps multiword tokens aside", () => {
    const s = parseConllu(`# sent_id = x
# text = I don't
1\tI\tI\tPRON\t_\t_\t3\tnsubj\t_\t_
2-3\tdon't\t_\t_\t_\t_\t_\t_\t_\t_
2\tdo\tdo\tAUX\t_\t_\t0\troot\t_\t_
3\tn't\tnot\tPART\t_\t_\t2\tadvmod\t_\t_
3.1\tgo\tgo\tVERB\t_\t_\t_\t_\t2:conj\t_
`)[0]!;
    expect(s.sentId).toBe("x");
    expect(s.words.map((w) => w.form)).toEqual(["I", "do", "n't"]);
    expect(s.multiwordTokens).toEqual([[2, 3, "don't"]]);
  });

  test("writes ten columns per word", () => {
    const out = writeConllu([{ form: "Hi", upos: "INTJ", head: 0, deprel: "root" }], { text: "Hi" });
    expect(out).toBe("# text = Hi\n1\tHi\t_\tINTJ\t_\t_\t0\troot\t_\t_\n");
  });

  test("universal part of a relation", () => {
    expect(universalDeprel("nmod:poss")).toBe("nmod");
    expect(universalDeprel("obj")).toBe("obj");
  });
});

describe("tokenizer (UD English conventions)", () => {
  const forms = (s: string) => tokenize(s).map((t) => t.form);
  test("splits clitics the way EWT does", () => {
    expect(forms("I don't think I'm late.")).toEqual(["I", "do", "n't", "think", "I", "'m", "late", "."]);
    expect(forms("can't won't cannot")).toEqual(["ca", "n't", "wo", "n't", "can", "not"]);
  });
  test("splits hyphens and punctuation, keeps abbreviations", () => {
    expect(forms("a 15-year term (Dr. Smith), right?")).toEqual(["a", "15", "-", "year", "term", "(", "Dr.", "Smith", ")", ",", "right", "?"]);
  });
  test("keeps numbers and URLs whole", () => {
    expect(forms("$3.50 at https://example.com")).toEqual(["$", "3.50", "at", "https://example.com"]);
  });
});

describe("confidence helpers (TypeSafe formulas)", () => {
  test("choice confidence is 0 for uniform and 1 for certain", () => {
    expect(choiceConfidence({ a: 0.25, b: 0.25, c: 0.25, d: 0.25 })).toBeCloseTo(0);
    expect(choiceConfidence({ a: 1, b: 0 })).toBeCloseTo(1);
  });
  test("noul confidence is |2p - 1|", () => {
    expect(noulConfidence(0.5)).toBe(0);
    expect(noulConfidence(0.9)).toBeCloseTo(0.8);
  });
  test("separation is top / second", () => {
    expect(separation([0.6, 0.3, 0.1])).toBeCloseTo(2);
  });
  test("path score is the geometric mean", () => {
    expect(pathScore([0.81, 1])).toBeCloseTo(0.9);
  });
  test("two-level composition ranks by path score and returns a normalized distribution", () => {
    const r = composeTwoLevel({ g1: 0.7, g2: 0.3 }, { g1: { a: 0.6, b: 0.4 }, g2: { c: 1 } });
    expect(r.best).toBe("a"); // sqrt(0.7 × 0.6) ≈ 0.648 beats sqrt(0.3 × 1) ≈ 0.548
    expect(r.separation).toBeCloseTo(Math.sqrt(0.42) / Math.sqrt(0.3));
    expect(Object.values(r.distribution).reduce((x, y) => x + y, 0)).toBeCloseTo(1);
  });
});
