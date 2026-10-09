// question-kit/node: the parts that need Node (or Bun) built-ins. The main entry stays free of
// them so it bundles for the browser. (`question-kit/cache` is Node-only too.)

import { appendFileSync } from "node:fs";
import type { Recorder } from "./recorder.ts";

/** Appends each gate event as a line of JSON to a file. */
export function jsonlRecorder(path: string): Recorder {
  return { record: (e) => appendFileSync(path, `${JSON.stringify(e)}\n`) };
}
