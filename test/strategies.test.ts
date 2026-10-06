import { describe, expect, test } from "bun:test";
import { CallLog } from "../src/calls.ts";
import { functionWordsCantBeHeads, reattachIntroducers } from "../src/code-rules/cleanup.ts";
import { proposeCandidates } from "../src/code-rules/rule-parser.ts";
import { goldOf } from "../src/gold.ts";
import { MockJevClient, noul, peakedChoice } from "../src/jev/mock.ts";
import { RecordingJevClient } from "../src/jev/recording.ts";
import type { ChoiceQuestion } from "../src/jev/types.ts";
import { oracleClient } from "../src/oracle.ts";
import * as attachTo from "../src/question-sets/attach-to.ts";
import * as direction from "../src/question-sets/direction.ts";
import * as neighborLinks from "../src/question-sets/neighbor-links.ts";
import * as phrases from "../src/question-sets/phrase-attach.ts";
import * as relationship from "../src/question-sets/relationship.ts";
import * as secondLook from "../src/question-sets/second-look.ts";
import * as wordType from "../src/question-sets/word-type.ts";
import { describeWord, sentenceOf } from "../src/sentence.ts";
import { EXPERIMENTS, LINEUP } from "../src/strategies/index.ts";
import { jevOnly } from "../src/strategies/ladder.ts";
import { parseConllu } from "../src/ud/conllu.ts";
import { buildTree, HeadVotes } from "../src/votes.ts";

const CONLLU = parseConllu(`# sent_id = t1
# text = The dog chased a red ball across the yard .
1\tThe\tthe\tDET\t_\t_\t2\tdet\t_\t_
2\tdog\tdog\tNOUN\t_\t_\t3\tnsubj\t_\t_
3\tchased\tchase\tVERB\t_\t_\t0\troot\t_\t_
4\ta\ta\tDET\t_\t_\t6\tdet\t_\t_
5\tred\tred\tADJ\t_\t_\t6\tamod\t_\t_
6\tball\tball\tNOUN\t_\t_\t3\tobj\t_\t_
7\tacross\tacross\tADP\t_\t_\t9\tcase\t_\t_
8\tthe\tthe\tDET\t_\t_\t9\tdet\t_\t_
9\tyard\tyard\tNOUN\t_\t_\t3\tobl\t_\t_
10\t.\t.\tPUNCT\t_\t_\t3\tpunct\t_\t_
`)[0]!;
const GOLD = goldOf(CONLLU);
const S = sentenceOf({ words: CONLLU.words.map((w) => w.form), text: CONLLU.text });

describe("gold phrases", () => {
  test("small phrases hang together; subject, verb and object are separate", () => {
    expect(GOLD.phrases.map((p) => p.map((id) => S.words[id - 1]).join(" "))).toEqual([
      "The dog",
      "chased",
      "a red ball",
      "across the yard",
      ".",
    ]);
  });
});

describe("question sets", () => {
  test("attach-to offers every other word plus root, in sentence order", () => {
    const q = attachTo.ask(S, { hints: "none" }).head_w3!;
    expect(Object.keys((q.question as ChoiceQuestion).criteria)).toEqual(["w1", "w2", "w4", "w5", "w6", "w7", "w8", "w9", "w10", "root"]);
    expect(q.meta.options?.w7).toBe(7);
    expect(String(q.question.instructions)).toContain("`words.w3`");
  });

  test("reversed order flips the words but keeps root last", () => {
    const q = attachTo.ask(S, { order: "reversed", hints: "none" }).head_w9!;
    expect(Object.keys((q.question as ChoiceQuestion).criteria).slice(0, 3)).toEqual(["w10", "w8", "w7"]);
  });

  test("repeated words get a distinguishing description", () => {
    const ws = ["the", "cat", "saw", "the", "cat", "too"];
    expect(describeWord(ws, 2)).toBe('`words.w2` ("cat", after "the", before "saw")');
    expect(describeWord(ws, 1)).toBe('`words.w1` ("the", the first word)');
  });

  test("nested word type asks a group question and one per group", () => {
    expect(Object.keys(wordType.ask(sentenceOf({ words: ["Hi"] }), "nested"))).toEqual(["pos_w1_group", "pos_w1_open", "pos_w1_closed", "pos_w1_other"]);
  });

  test("relationship questions cover the 36 non-root relationships exactly once", () => {
    const batch = relationship.ask(S, [[1, 2]]);
    const rels = Object.entries(batch)
      .filter(([id]) => id !== "rel_w1_group")
      .flatMap(([, q]) => Object.keys((q.question as ChoiceQuestion).criteria));
    expect(rels.length).toBe(36);
    expect(new Set(rels).size).toBe(36);
  });

  test("neighbor links: one yes/no per adjacent pair; phrases cut where p < 0.5", () => {
    expect(Object.keys(neighborLinks.ask(S)).length).toBe(9);
    expect(neighborLinks.phrasesFrom(4, [0, 0.9, 0.2, 0.7])).toEqual([[1, 2], [3, 4]]);
  });

  test("direction spreads each answer over the words it covers", () => {
    const answers = { dir_w3: peakedChoice(["just-before", "further-before", "just-after", "further-after", "main"], "further-before", 0.6) };
    const dist = direction.read(sentenceOf({ words: ["a", "b", "c", "d", "e"] }), answers).get(3)!;
    expect(dist[1]).toBeCloseTo(0.6); // "further before" word 3 is only word 1
    expect(dist[2]).toBeCloseTo(0.1);
    expect(Object.values(dist).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  test("phrases: inside × between answers become votes on words", () => {
    const ps = [[1, 2], [3]];
    const answers = {
      in_w1: peakedChoice(["w2", "outside"], "w2", 0.9),
      in_w2: peakedChoice(["w1", "outside"], "outside", 0.8),
      pa_p1: peakedChoice(["p2", "root"], "p2", 0.7),
      pa_p2: peakedChoice(["p1", "root"], "root", 0.9),
    };
    const r = phrases.read(sentenceOf({ words: ["the", "dog", "barked"] }), ps, answers);
    expect(r.mainWords).toEqual([2, 3]);
    expect(r.votes.get(2)![3]).toBeCloseTo(0.8 * 0.7); // dog → barked via "outside" × "phrase 2"
    expect(r.votes.get(1)![2]).toBeCloseTo(0.9);
  });

  test("second look picks out close calls only", () => {
    const v = new HeadVotes(3);
    v.add("x", 1, { 2: 0.5, 3: 0.4, 0: 0.1 });
    v.add("x", 2, { 3: 0.95, 1: 0.05 });
    v.add("x", 3, { 0: 0.9, 1: 0.1 });
    expect(secondLook.closeCalls(v, 3)).toEqual([[1, 2, 3]]);
  });
});

describe("votes and the tree builder", () => {
  test("two question sets' votes multiply", () => {
    const v = new HeadVotes(2);
    v.add("a", 1, { 2: 0.6, 0: 0.4 });
    v.add("b", 1, { 2: 0.2, 0: 0.8 });
    expect(v.combined(1)[0]).toBeCloseTo((0.4 * 0.8) / (0.4 * 0.8 + 0.6 * 0.2));
  });

  test("the tree builder breaks a loop that top answers would make", () => {
    const v = new HeadVotes(2);
    v.add("a", 1, { 2: 0.6, 0: 0.4 });
    v.add("a", 2, { 1: 0.55, 0: 0.45 });
    expect(v.topHeads()).toEqual([-1, 2, 1]);
    const heads = buildTree(v);
    expect(heads.filter((h, d) => d > 0 && h === 0).length).toBe(1);
  });
});

describe("code rules", () => {
  test("function words can't be heads, unless nothing else is left", () => {
    const banned = functionWordsCantBeHeads(["", "VERB", "ADP", "NOUN"]);
    expect(banned(2, 3)).toBe(true);
    expect(banned(1, 3)).toBe(false);
  });

  test("an introducing word moves from its grandparent to the word it introduces", () => {
    const types = ["", "VERB", "ADP", "DET", "NOUN"];
    expect(reattachIntroducers([-1, 0, 1, 4, 1], types).heads).toEqual([-1, 0, 4, 4, 1]);
    expect(reattachIntroducers([-1, 0, 4, 4, 1], types).moved).toEqual([]);
  });

  test("candidates include the rules' pick, both neighbors and root", () => {
    const c = proposeCandidates(["DET", "NOUN", "VERB", "ADP", "NOUN"], [2, 3, 0, 5, 3]);
    expect(c[3]).toContain(5);
    expect(c[3]).toContain(3);
    expect(c[3]).toContain(0);
    expect(c[0]).not.toContain(1);
  });
});

describe("calls", () => {
  test("a call carries several question sets in one request; meta stays out of the cache key", async () => {
    const jev = new MockJevClient();
    const log = new CallLog(jev);
    await log.call("both", { sentence: "x" }, wordType.ask(S), attachTo.ask(S));
    expect(log.calls.length).toBe(1);
    expect(Object.keys(jev.calls[0]!.questions).length).toBe(20);
    const r = jev.calls[0]!;
    expect(RecordingJevClient.key(r)).toBe(RecordingJevClient.key({ state: r.state, questions: r.questions }));
  });

  test("a call too big for one request is split, keeping every question", async () => {
    const jev = new MockJevClient();
    const log = new CallLog(jev, 1500);
    await log.call("big", { sentence: "x" }, attachTo.ask(S));
    expect(log.calls.length).toBeGreaterThan(1);
    expect(log.calls.flatMap((c) => Object.keys(c.request.questions))).toEqual(Object.keys(attachTo.ask(S)));
  });
});

describe("strategies with the gold-tree oracle (plumbing)", () => {
  const exact = ["jev-only", "jev-phrases", "jev-phrases-plus-attach", "jev-with-cleanup", "code-proposes-jev-picks"];
  for (const s of [...LINEUP, ...EXPERIMENTS].filter((x) => exact.includes(x.name) || x.name.startsWith("jev-only/"))) {
    test(`${s.name} rebuilds the gold tree from perfect answers`, async () => {
      const r = await s.parse({ words: S.words, text: S.text }, oracleClient(GOLD));
      expect(r.edges.map((e) => e.head)).toEqual(CONLLU.words.map((w) => w.head));
      expect(r.edges.map((e) => e.deprel)).toEqual(CONLLU.words.map((w) => w.deprel));
    });
  }

  test("every call is recorded with what each question is about", async () => {
    const r = await jevOnly.parse({ words: S.words, text: S.text }, oracleClient(GOLD));
    expect(r.calls.map((c) => c.title)).toEqual(["word types + attachments", "relationships"]);
    const meta = r.calls[0]!.meta.head_w9!;
    expect(meta).toEqual(expect.objectContaining({ set: "attach-to", word: 9 }));
    expect(r.steps.some((s) => s.text.startsWith("Tree builder"))).toBe(true);
  });

  test("noul answers from the oracle follow the gold phrases", async () => {
    const jev = oracleClient(GOLD);
    const log = new CallLog(jev);
    const a = await log.call("links", { sentence: S.text }, neighborLinks.ask(S));
    expect(neighborLinks.read(S, a).slice(1).map((p) => p >= 0.5)).toEqual([true, false, false, true, true, false, true, true, false]);
    expect(noul(0.9).noul).toBe(0.9);
  });
});
