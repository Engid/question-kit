// Sending a set of tasks about one order: question-kit's `runAll` (one request, split only if it
// would be too big), plus the `meta` bookkeeping the order taker keeps for logs and for explaining
// an order: what each question was about.

import { requestAll, type RunOptions, runAll, type SystemOneCall, type SystemOneClient, type Task } from "../core/index.ts";
import type { About, Asked } from "./questions.ts";

/**
 * Run every task in `asked` together, about `state`, and return each task's reading by the task's
 * name. Each request made is pushed onto `log`. Each question's `about` goes into the request's
 * `meta` under the question's id (a task's question ids start with the task's name).
 */
export async function askAll<T>(client: SystemOneClient, log: SystemOneCall[], title: string, state: RunOptions["state"], asked: Asked<T>): Promise<Record<string, T>> {
  const tasks = asked.tasks as Record<string, Task<unknown>>;
  const meta: Record<string, About> = {};
  for (const id of Object.keys(requestAll(tasks, { state }).questions)) {
    const name = id.split("::")[0]!;
    if (asked.about[name]) meta[id] = asked.about[name];
  }
  return (await runAll(client, tasks, { state, log, title, meta })) as Record<string, T>;
}
