// Tasks: a set of questions plus the code that reads their answers.
//
// Every one-request method returns a Task. `run` sends one; `runAll` sends several in a single
// request, because TypeSafe recommends asking everything about the same state at once
// (https://docs.typesafe.ai/cookbooks/parallel_questions.md). Each task's own state parts go under
// its name, and its question ids are prefixed with it, so tasks never collide. A value several tasks
// share is sent once.

import { type Answer, type Entry, type SystemOneClient, type Json, type Question, type SendOptions, send } from "./system-one.ts";
import { LintError, lint, type Problem } from "./lint.ts";
import { Ref, type Text } from "./state.ts";

export interface Task<T> {
  /** State this task adds, relative to where it's placed. */
  parts: Record<string, Json>;
  /** The questions, given a way to point at the task's own parts. */
  questions(at: (name: string) => Ref): Record<string, Question>;
  /** Read the answers (keyed by this task's own ids) into a result. */
  read(answers: Record<string, Answer>): T;
}

export interface RunOptions extends SendOptions {
  /** State to send along with the tasks' own parts (for tasks that point at it with Refs). */
  state?: Record<string, Json>;
  /** Warnings from the pre-send checks are pushed here. Errors throw. */
  warnings?: Problem[];
}

/** Build the state and questions for a task without sending anything. */
export function request<T>(task: Task<T>, opts: Pick<RunOptions, "state"> = {}): { state: Entry; questions: Record<string, Question> } {
  const state = { ...(opts.state ?? {}), ...task.parts };
  return { state, questions: task.questions((name) => new Ref(name)) };
}

export async function run<T>(client: SystemOneClient, task: Task<T>, opts: RunOptions = {}): Promise<T> {
  const { state, questions } = request(task, opts);
  check(state, questions, opts);
  const answers = await send(client, state, questions, opts);
  return task.read(answers);
}

/**
 * Build the state and questions for several tasks sent together.
 *
 * A value several tasks were given (the customer's message, say) is sent once: the first task to
 * bring it keeps it under its own name, and the others point their questions at that copy. A task
 * value equal to a top-level part of `opts.state` points there instead. Two parts of the same task
 * are never merged, even when equal, so a task comparing `a` with `b` still names both.
 */
export function requestAll<M extends Record<string, Task<unknown>>>(tasks: M, opts: Pick<RunOptions, "state"> = {}): { state: Entry; questions: Record<string, Question> } {
  const state: Record<string, Json> = { ...(opts.state ?? {}) };
  const questions: Record<string, Question> = {};
  // Where each value already is, keyed by its JSON; the first copy wins.
  const seen = new Map<string, string>();
  for (const [key, value] of Object.entries(state)) if (!seen.has(JSON.stringify(value))) seen.set(JSON.stringify(value), key);
  for (const [name, task] of Object.entries(tasks)) {
    if (name.includes("::") || name.includes(".")) throw new Error(`task name "${name}" can't contain "::" or "."`);
    const own: Record<string, Json> = {};
    const where: Record<string, string> = {};
    const json = Object.fromEntries(Object.entries(task.parts).map(([part, value]) => [part, JSON.stringify(value)]));
    const repeated = (part: string) => Object.entries(json).some(([p, j]) => p !== part && j === json[part]);
    for (const [part, value] of Object.entries(task.parts)) {
      const first = repeated(part) ? undefined : seen.get(json[part]!);
      if (first !== undefined) where[part] = first;
      else {
        own[part] = value;
        where[part] = `${name}.${part}`;
      }
    }
    for (const part of Object.keys(own)) if (!seen.has(json[part]!)) seen.set(json[part]!, where[part]!);
    if (Object.keys(own).length) {
      if (name in state) throw new Error(`task name "${name}" collides with a state part`);
      state[name] = own;
    }
    const qs = task.questions((part) => new Ref(where[part] ?? `${name}.${part}`));
    for (const [id, qn] of Object.entries(qs)) questions[`${name}::${id}`] = qn;
  }
  return { state, questions };
}

export async function runAll<M extends Record<string, Task<unknown>>>(client: SystemOneClient, tasks: M, opts: RunOptions = {}): Promise<{ [K in keyof M]: M[K] extends Task<infer T> ? T : never }> {
  const { state, questions } = requestAll(tasks, opts);
  check(state, questions, opts);
  const answers = await send(client, state, questions, opts);
  const out: Record<string, unknown> = {};
  for (const [name, task] of Object.entries(tasks)) {
    const own: Record<string, Answer> = {};
    const prefix = `${name}::`;
    for (const [id, a] of Object.entries(answers)) if (id.startsWith(prefix)) own[id.slice(prefix.length)] = a;
    out[name] = task.read(own);
  }
  return out as { [K in keyof M]: M[K] extends Task<infer T> ? T : never };
}

function check(state: Entry, questions: Record<string, Question>, opts: RunOptions) {
  const problems = lint(state, questions);
  const errors = problems.filter((p) => p.level === "error");
  if (errors.length) throw new LintError(errors);
  opts.warnings?.push(...problems.filter((p) => p.level === "warning"));
}

/**
 * Where a method's text lives: a Ref the caller already put in the state, or a new part of the
 * task's own (copied in under `name`).
 */
export function place(text: Text, name: string): { parts: Record<string, Json>; ref: (at: (n: string) => Ref) => Ref } {
  if (text instanceof Ref) return { parts: {}, ref: () => text };
  return { parts: { [name]: text }, ref: (at) => at(name) };
}

/** Prefix a sub-task's question ids, for methods built from other methods. */
export function nest<T>(prefix: string, task: Task<T>): Task<T> {
  return {
    parts: task.parts,
    questions(at) {
      const qs = task.questions(at);
      return Object.fromEntries(Object.entries(qs).map(([id, qn]) => [`${prefix}.${id}`, qn]));
    },
    read(answers) {
      const own: Record<string, Answer> = {};
      for (const [id, a] of Object.entries(answers)) if (id.startsWith(`${prefix}.`)) own[id.slice(prefix.length + 1)] = a;
      return task.read(own);
    },
  };
}
