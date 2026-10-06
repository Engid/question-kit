import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type ConlluSentence, parseConllu } from "../src/ud/conllu.ts";

export const UD_DIR = join(import.meta.dir, "..", "data", "ud");

/** UD English EWT, pinned to the r2.18 release (2026-05-15). License: CC BY-SA 4.0. */
export const EWT = {
  release: "r2.18",
  base: "https://raw.githubusercontent.com/UniversalDependencies/UD_English-EWT/r2.18",
  files: {
    dev: { name: "en_ewt-ud-dev.conllu", sha256: "39239e0a60db3ae68f4b7036189f11b6692741d10ff8240dd91f74f2760d90f8" },
    test: { name: "en_ewt-ud-test.conllu", sha256: "fa024f43dc5da3c5ac02563bc9bd0e974f46cbb1560823976a8f342a37dc494a" },
    train: { name: "en_ewt-ud-train.conllu", sha256: "d68e06122a702464c613076523d56740f047e5bbe89dd90ec32737e04d952143" },
  },
} as const;

export type Split = keyof typeof EWT.files;

export function loadSplit(split: Split): ConlluSentence[] {
  const path = join(UD_DIR, EWT.files[split].name);
  if (!existsSync(path)) throw new Error(`${path} not found. Run \`bun run fetch-ud\` first.`);
  return parseConllu(readFileSync(path, "utf8"));
}

export const BUCKETS = [
  { name: "1-5", min: 1, max: 5 },
  { name: "6-10", min: 6, max: 10 },
  { name: "11-20", min: 11, max: 20 },
  { name: "21-40", min: 21, max: 40 },
  { name: "41+", min: 41, max: Infinity },
] as const;

export function bucketOf(n: number): string {
  return (BUCKETS.find((b) => n >= b.min && n <= b.max) ?? BUCKETS[BUCKETS.length - 1]!).name;
}

/** Deterministic shuffle (mulberry32) so samples are the same on every machine. */
export function shuffled<T>(items: T[], seed: number): T[] {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export interface SampleOptions {
  perBucket?: number;
  maxLen?: number;
  limit?: number;
  seed?: number;
  ids?: string[];
  /** Sentence ids to leave out, e.g. a previous run's sample, for a held-out comparison. */
  exclude?: string[];
}

/** A reproducible sample: shuffle with a fixed seed, then take up to `perBucket` per length bucket. */
export function sample(sentences: ConlluSentence[], o: SampleOptions): ConlluSentence[] {
  if (o.ids?.length) {
    const want = new Set(o.ids);
    return sentences.filter((s) => want.has(s.sentId));
  }
  const skip = new Set(o.exclude ?? []);
  let pool = shuffled(sentences, o.seed ?? 20261006).filter((s) => s.words.length <= (o.maxLen ?? Infinity) && !skip.has(s.sentId));
  if (o.perBucket !== undefined) {
    const counts = new Map<string, number>();
    pool = pool.filter((s) => {
      const b = bucketOf(s.words.length);
      const c = counts.get(b) ?? 0;
      if (c >= (o.perBucket as number)) return false;
      counts.set(b, c + 1);
      return true;
    });
  }
  return o.limit !== undefined ? pool.slice(0, o.limit) : pool;
}
