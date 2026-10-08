// Recording gate decisions: the minimal hook.
//
// Wherever code acts on an answer only above a confidence (a gate), it can report the decision
// here: which method and task, the confidence, the threshold, and what it did. That's all the open
// library records by default. It's enough to see where and how often answers fall under a gate; a
// recorder of your own can send the events anywhere.

import { appendFileSync } from "node:fs";

export interface GateEvent {
  /** The method or component that decided: "classify", "service-agent.intent". */
  method: string;
  /** What it was deciding about: an intent list's name, a slot, a step. */
  task?: string;
  confidence: number;
  threshold: number;
  /** What the code did: "act", "unsure" (asked again, backed off), "skip". */
  decision: string;
  /** Joins the event to the request that produced the answer, when known. */
  callId?: string;
  /** When it happened, ISO 8601. Filled in by `gate()` if left out. */
  at?: string;
}

export interface Recorder {
  record(event: GateEvent): void;
}

/** Records nothing. The default. */
export const noRecorder: Recorder = { record() {} };

/** One line per event on stderr. */
export const consoleRecorder: Recorder = {
  record(e) {
    console.error(`gate ${e.method}${e.task ? ` ${e.task}` : ""}: ${e.decision} (confidence ${e.confidence.toFixed(2)}, threshold ${e.threshold})`);
  },
};

/** Appends each event as a line of JSON to a file. */
export function jsonlRecorder(path: string): Recorder {
  return { record: (e) => appendFileSync(path, `${JSON.stringify(e)}\n`) };
}

/** Collects events in memory, for tests and evals. */
export function memoryRecorder(): Recorder & { events: GateEvent[] } {
  const events: GateEvent[] = [];
  return { events, record: (e) => events.push(e) };
}

/**
 * Gate a confidence: "act" at or above the threshold, otherwise "unsure". Records the decision.
 * Code that has a third outcome (such as "skip" for an answer of "none") records it itself.
 */
export function gate(confidence: number, threshold: number, recorder: Recorder, event: Omit<GateEvent, "confidence" | "threshold" | "decision">): "act" | "unsure" {
  const decision = confidence >= threshold ? "act" : "unsure";
  recorder.record({ ...event, confidence, threshold, decision, at: event.at ?? new Date().toISOString() });
  return decision;
}
