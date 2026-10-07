// Where things live, from the repo root: the answer cache, the downloaded data, and run results.

import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..", "..");
/** Jev's answers, cached by the recording client (git-ignored). */
export const CACHE_DIR = join(ROOT, ".cache", "jev");
/** Downloaded datasets (git-ignored): data/ud, data/pizza. */
export const DATA_DIR = join(ROOT, "data");
/** Run results (git-ignored). */
export const RESULTS_DIR = join(ROOT, "results");
