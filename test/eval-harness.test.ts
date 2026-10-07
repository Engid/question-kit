import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calibration, scoreSentence, aggregate, type EdgeObs } from "../research/parsing/eval/metrics.ts";
import { bucketOf, sample, shuffled } from "../research/parsing/eval/data.ts";
import { MockJevClient, peakedChoice } from "../research/lab/jev/mock.ts";
import { CacheMissError, RecordingJevClient } from "../research/lab/jev/recording.ts";
import type { JevRequest } from "../research/lab/jev/types.ts";
import { parseConllu } from "../research/parsing/src/ud/conllu.ts";

const REQ: JevRequest = {
  state: { sentence: "hi there" },
  questions: { q: { type: "choice", instructions: "pick", criteria: { a: "A", b: "B" } } },
};

describe("recording client", () => {
  test("record saves on a miss, replay answers from the cache without the inner client", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jev-cache-"));
    const inner = new MockJevClient((_, q) => (q.type === "choice" ? peakedChoice(Object.keys(q.criteria), "b", 0.8) : undefined));
    const rec = new RecordingJevClient(inner, dir, "record");
    const first = await rec.systemOne(REQ);
    expect(inner.calls.length).toBe(1);
    expect(rec.misses).toBe(1);
    await rec.systemOne(REQ);
    expect(inner.calls.length).toBe(1); // second call is a hit
    expect(rec.hits).toBe(1);

    const replay = new RecordingJevClient(undefined, dir, "replay");
    expect(await replay.systemOne(REQ)).toEqual(first);
    expect(readdirSync(dir).length).toBe(1);
  });

  test("replay throws CacheMissError on an unseen request", async () => {
    const replay = new RecordingJevClient(undefined, mkdtempSync(join(tmpdir(), "jev-cache-")), "replay");
    await expect(replay.systemOne(REQ)).rejects.toBeInstanceOf(CacheMissError);
  });

  test("option order is part of the cache key", () => {
    const flipped: JevRequest = { ...REQ, questions: { q: { type: "choice", instructions: "pick", criteria: { b: "B", a: "A" } } } };
    expect(RecordingJevClient.key(REQ)).not.toBe(RecordingJevClient.key(flipped));
  });
});

const GOLD = parseConllu(`# sent_id = s1
# text = Dogs bark loudly .
1\tDogs\tdog\tNOUN\t_\t_\t2\tnsubj\t_\t_
2\tbark\tbark\tVERB\t_\t_\t0\troot\t_\t_
3\tloudly\tloudly\tADV\t_\t_\t2\tadvmod\t_\t_
4\t.\t.\tPUNCT\t_\t_\t2\tpunct\t_\t_
`)[0]!;

describe("metrics", () => {
  test("UAS counts heads; LAS also needs the universal label; subtypes are ignored", () => {
    const s = scoreSentence(GOLD, {
      upos: ["NOUN", "VERB", "ADJ", "PUNCT"],
      heads: [2, 0, 2, 3],
      deprels: ["nsubj:pass", "root", "obj", "punct"],
    });
    expect(s.upos).toBe(3);
    expect(s.uas).toBe(3); // word 4's head is wrong
    expect(s.las).toBe(2); // nsubj:pass counts as nsubj; word 3 has the right head but the wrong label
  });

  test("right pair counts treebank links found in either direction", () => {
    // Words 1 and 2 are linked the wrong way round; 3 and 4 hang off the right word.
    const s = scoreSentence(GOLD, { upos: ["X", "X", "X", "X"], heads: [0, 1, 2, 2], deprels: ["root", "nsubj", "advmod", "punct"] });
    expect(s.uas).toBe(2);
    expect(s.links).toBe(3);
    expect(s.pairs).toBe(3);
  });

  test("aggregate is micro-averaged over words", () => {
    const a = scoreSentence(GOLD, { upos: ["X", "X", "X", "X"], heads: [2, 0, 2, 2], deprels: ["nsubj", "root", "advmod", "punct"] });
    const b = scoreSentence({ ...GOLD, words: GOLD.words.slice(0, 2) }, { upos: ["X", "X"], heads: [0, 0], deprels: ["root", "root"] });
    const agg = aggregate([a, b]);
    expect(agg.words).toBe(6);
    expect(agg.uas).toBeCloseTo(5 / 6);
  });

  test("calibration bins and separation flags", () => {
    const e = (p: number, separation: number, ok: boolean): EdgeObs => ({
      word: 1, goldHead: 0, head: 0, argmax: 0, judged: true, p, separation, headCorrect: ok, labelCorrect: ok, argmaxCorrect: ok, goldDeprel: "dep",
    });
    const cal = calibration([e(0.95, 10, true), e(0.92, 8, true), e(0.35, 1.1, false), e(0.3, 1.2, true)]);
    expect(cal.bins[9]!.count).toBe(2);
    expect(cal.bins[3]!.count).toBe(2);
    const at2 = cal.flags.find((f) => f.threshold === 2)!;
    expect(at2.flagged).toBe(2);
    expect(at2.recall).toBe(1); // the one wrong edge is flagged
    expect(at2.precision).toBe(0.5);
    expect(at2.accuracyAbove).toBe(1);
  });
});

describe("sampling", () => {
  test("is deterministic and respects buckets", () => {
    const fake = Array.from({ length: 40 }, (_, i) => ({ ...GOLD, sentId: `s${i}`, words: GOLD.words.concat(Array(i % 12).fill(GOLD.words[0])) }));
    const a = sample(fake, { perBucket: 2 });
    const b = sample(fake, { perBucket: 2 });
    expect(a.map((s) => s.sentId)).toEqual(b.map((s) => s.sentId));
    const perBucket = new Map<string, number>();
    for (const s of a) perBucket.set(bucketOf(s.words.length), (perBucket.get(bucketOf(s.words.length)) ?? 0) + 1);
    expect([...perBucket.values()].every((c) => c <= 2)).toBe(true);
    expect(shuffled([1, 2, 3, 4, 5], 1)).toEqual(shuffled([1, 2, 3, 4, 5], 1));
  });
});

describe("held-out sampling", () => {
  test("--exclude leaves out earlier ids", () => {
    const fake = Array.from({ length: 30 }, (_, i) => ({ ...GOLD, sentId: `s${i}` }));
    const first = sample(fake, { perBucket: 5 });
    const second = sample(fake, { perBucket: 5, exclude: first.map((s) => s.sentId) });
    expect(second.some((s) => first.some((f) => f.sentId === s.sentId))).toBe(false);
  });
});
