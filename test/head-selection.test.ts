import { describe, expect, test } from "bun:test";
import { MockJevClient, peakedChoice } from "../src/jev/mock.ts";
import { oracleClient } from "../src/jev/oracle.ts";
import type { ChoiceQuestion } from "../src/jev/types.ts";
import { type HeadSelectionOptions, headSelection } from "../src/strategies/head-selection/index.ts";
import { describeWord, headQuestions, posQuestions, relationQuestions } from "../src/strategies/head-selection/questions.ts";
import { parseConllu } from "../src/ud/conllu.ts";

const GOLD = parseConllu(`# text = I want a large latte .
1\tI\tI\tPRON\t_\t_\t2\tnsubj\t_\t_
2\twant\twant\tVERB\t_\t_\t0\troot\t_\t_
3\ta\ta\tDET\t_\t_\t5\tdet\t_\t_
4\tlarge\tlarge\tADJ\t_\t_\t5\tamod\t_\t_
5\tlatte\tlatte\tNOUN\t_\t_\t2\tobj\t_\t_
6\t.\t.\tPUNCT\t_\t_\t2\tpunct\t_\t_
`)[0]!;
const WORDS = GOLD.words.map((w) => w.form);
const INPUT = { words: WORDS, text: GOLD.text };

describe("questions", () => {
  test("head options are every other word plus root, in sentence order", () => {
    const qs = headQuestions(WORDS, { order: "sentence", hints: "none" });
    const q = qs.head_w3 as ChoiceQuestion;
    expect(Object.keys(q.criteria)).toEqual(["w1", "w2", "w4", "w5", "w6", "root"]);
    expect(String(q.instructions)).toContain("`words.w3`");
  });

  test("reversed order flips the words but keeps root last", () => {
    const q = headQuestions(WORDS, { order: "reversed", hints: "none" }).head_w3 as ChoiceQuestion;
    expect(Object.keys(q.criteria)).toEqual(["w6", "w5", "w4", "w2", "w1", "root"]);
  });

  test("repeated words get a distinguishing description", () => {
    const ws = ["the", "cat", "saw", "the", "cat", "too"];
    expect(describeWord(ws, 2)).toBe('`words.w2` ("cat", after "the", before "saw")');
    expect(describeWord(ws, 5)).toBe('`words.w5` ("cat", after "the", before "too")');
    expect(describeWord(ws, 1)).toBe('`words.w1` ("the", the first word)');
  });

  test("hierarchical POS asks a group question and one fine question per group", () => {
    const qs = posQuestions(2, "hierarchical");
    expect(Object.keys(qs)).toEqual(["pos_w1_group", "pos_w1_open", "pos_w1_closed", "pos_w1_other", "pos_w2_group", "pos_w2_open", "pos_w2_closed", "pos_w2_other"]);
  });

  test("relation questions cover the 36 non-root relations exactly once", () => {
    const qs = relationQuestions(3, 5);
    const rels = Object.entries(qs)
      .filter(([id]) => id !== "rel_w3_group")
      .flatMap(([, q]) => Object.keys((q as ChoiceQuestion).criteria));
    expect(rels.length).toBe(36);
    expect(new Set(rels).size).toBe(36);
    expect(rels).not.toContain("root");
  });

  test("a one-word sentence asks no head question", () => {
    expect(headQuestions(["Hi"], { order: "sentence", hints: "v1" })).toEqual({});
  });
});

describe("head-selection with an oracle scorer", () => {
  const variants: [string, Partial<HeadSelectionOptions>][] = [
    ["default", {}],
    ["hierarchical POS", { pos: "hierarchical" }],
    ["single request", { requests: "single" }],
    ["three-stage pruned", { requests: "three-stage", prune: ["no-punct-heads"] }],
    ["both orders", { order: "both" }],
    ["neighbors context", { context: "neighbors" }],
  ];
  for (const [name, opts] of variants) {
    test(`${name}: reproduces the gold tree`, async () => {
      const r = await headSelection("t", opts).parse(INPUT, oracleClient(GOLD.words));
      expect(r.edges.map((e) => e.head)).toEqual(GOLD.words.map((w) => w.head));
      expect(r.edges.map((e) => e.deprel)).toEqual(GOLD.words.map((w) => w.deprel));
      expect(r.tokens.map((t) => t.upos)).toEqual(GOLD.words.map((w) => w.upos));
    });
  }

  test("request counts match the staging", async () => {
    const two = await headSelection("t").parse(INPUT, oracleClient(GOLD.words));
    expect(two.stats.requests).toBe(2);
    expect(two.trace.map((t) => t.stage)).toEqual(["pos+heads", "relations"]);
    const one = await headSelection("t", { requests: "single" }).parse(INPUT, oracleClient(GOLD.words));
    expect(one.stats.requests).toBe(1);
    const three = await headSelection("t", { requests: "three-stage" }).parse(INPUT, oracleClient(GOLD.words));
    expect(three.stats.requests).toBe(3);
  });

  test("maxQuestionsPerRequest splits requests", async () => {
    const r = await headSelection("t", { maxQuestionsPerRequest: 5 }).parse(INPUT, oracleClient(GOLD.words));
    expect(r.trace.every((t) => Object.keys(t.request.questions).length <= 5)).toBe(true);
    expect(r.edges.map((e) => e.head)).toEqual(GOLD.words.map((w) => w.head));
  });

  test("emits CoNLL-U that round-trips", async () => {
    const r = await headSelection("t").parse(INPUT, oracleClient(GOLD.words));
    const back = parseConllu(r.conllu)[0]!;
    expect(back.words.map((w) => [w.form, w.upos, w.head, w.deprel])).toEqual(GOLD.words.map((w) => [w.form, w.upos, w.head, w.deprel]));
  });
});

describe("decoding", () => {
  test("MST repairs a cycle that argmax would keep, and reports the disagreement", async () => {
    // Jev (mocked) says w1 → w2 and w2 → w1 most strongly; the MST must break the cycle.
    const client = new MockJevClient((id, q) => {
      if (q.type !== "choice") return undefined;
      const opts = Object.keys(q.criteria);
      if (id === "head_w1") return peakedChoice(opts, "w2", 0.6);
      if (id === "head_w2") return peakedChoice(opts, "w1", 0.55);
      return undefined;
    });
    const words = { words: ["a", "b"], text: "a b" };
    const mst = await headSelection("t").parse(words, client);
    const heads = mst.edges.map((e) => e.head);
    expect(heads.filter((h) => h === 0).length).toBe(1);
    expect(mst.stats.argmaxDisagreements).toBe(1);
    const argmax = await headSelection("t", { decode: "argmax" }).parse(words, client);
    expect(argmax.edges.map((e) => e.head)).toEqual([2, 1]);
  });

  test("an edge keeps Jev's probability for the decoded head and the top/second separation", async () => {
    const client = new MockJevClient((id, q) => {
      if (q.type !== "choice") return undefined;
      const opts = Object.keys(q.criteria);
      if (id === "head_w1") return peakedChoice(opts, "root", 0.8);
      if (id === "head_w2") return peakedChoice(opts, "w1", 0.5);
      return undefined;
    });
    const r = await headSelection("t").parse({ words: ["go", "now"], text: "go now" }, client);
    const e = r.edges[1]!;
    expect(e.head).toBe(1);
    expect(e.p).toBeCloseTo(0.5);
    expect(e.separation).toBeCloseTo(1); // two options: 0.5 vs 0.5
  });
});

describe("request limits and diagnostics", () => {
  test("a token budget splits a request without losing or reordering questions", async () => {
    const { Session } = await import("../src/strategies/common.ts");
    const qs = headQuestions(WORDS, { order: "sentence", hints: "v1" });
    const s = new Session(new MockJevClient(), { maxRequestTokens: 1500 });
    const batches = s.plan({ sentence: GOLD.text }, qs);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat()).toEqual(Object.keys(qs));
    const unlimited = new Session(new MockJevClient(), {}).plan({ sentence: GOLD.text }, qs);
    expect(unlimited.length).toBe(1);
  });

  test("the default budget keeps short sentences in one request per stage", async () => {
    const r = await headSelection("t").parse(INPUT, oracleClient(GOLD.words));
    expect(r.trace.map((t) => t.stage)).toEqual(["pos+heads", "relations"]);
  });

  test("hint v2 states the converse rules; none drops them", () => {
    const v2 = String((headQuestions(WORDS, { order: "sentence", hints: "v2" }).head_w3 as ChoiceQuestion).instructions);
    expect(v2).toContain("never to the preposition");
    const none = String((headQuestions(WORDS, { order: "sentence", hints: "none" }).head_w3 as ChoiceQuestion).instructions);
    expect(none).not.toContain("Universal Dependencies");
  });

  test("mutual first-ranked heads are counted", async () => {
    const client = new MockJevClient((id, q) => {
      if (q.type !== "choice") return undefined;
      const opts = Object.keys(q.criteria);
      if (id === "head_w1") return peakedChoice(opts, "w2", 0.9);
      if (id === "head_w2") return peakedChoice(opts, "w1", 0.9);
      if (id === "head_w3") return peakedChoice(opts, "root", 0.9);
      return undefined;
    });
    const r = await headSelection("t").parse({ words: ["a", "b", "c"], text: "a b c" }, client);
    expect(r.stats.argmaxMutualPairs).toBe(1);
  });
});

describe("decode-time UD conventions", () => {
  const tok = (form: string, upos: string, id: number) => ({ id, form, upos, uposDist: {}, uposSeparation: 1 });
  test("an introducing function word moves from its grandparent onto the word it introduces", async () => {
    const { reattachFunctionWords } = await import("../src/strategies/head-selection/index.ts");
    const tokens = [tok("chased", "VERB", 1), tok("across", "ADP", 2), tok("the", "DET", 3), tok("yard", "NOUN", 4)];
    // across → chased, the → yard, yard → chased (the traditional analysis)
    expect(reattachFunctionWords([0, 1, 4, 1], tokens)).toEqual([0, 4, 4, 1]);
    // already UD-style: unchanged
    expect(reattachFunctionWords([0, 4, 4, 1], tokens)).toEqual([0, 4, 4, 1]);
  });

  test("the decode mask removes function-word heads", async () => {
    // Jev (mocked) puts the noun under the preposition; with the mask, the noun must take another head.
    const words = ["chased", "across", "yard"];
    const client = new MockJevClient((id, q) => {
      if (q.type !== "choice") return undefined;
      const opts = Object.keys(q.criteria);
      if (id === "pos_w1") return peakedChoice(opts, "VERB", 0.9);
      if (id === "pos_w2") return peakedChoice(opts, "ADP", 0.9);
      if (id === "pos_w3") return peakedChoice(opts, "NOUN", 0.9);
      if (id === "head_w1") return peakedChoice(opts, "root", 0.9);
      if (id === "head_w2") return peakedChoice(opts, "w3", 0.8);
      if (id === "head_w3") return peakedChoice(opts, "w2", 0.8);
      return undefined;
    });
    const plain = await headSelection("t", { labels: false }).parse({ words, text: "chased across yard" }, client);
    const masked = await headSelection("t", { labels: false, decodeMask: ["no-function-heads"] }).parse({ words, text: "chased across yard" }, client);
    expect(masked.edges.map((e) => e.head)).toEqual([0, 3, 1]);
    expect(plain.edges[2]!.head).not.toBe(1);
  });
});
