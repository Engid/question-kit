// Requests built by the TypeScript package, for the Python port's parity test.
//
//   bun python/scripts/parity-fixtures.ts      (from the repository root)
//
// Writes python/tests/fixtures/parity.json: for each case, the state and questions the TypeScript
// core sends and the request's cache key. python/tests/test_parity.py builds the same cases with
// question_kit and checks it sends byte-for-byte the same request, so the two can share one answer
// cache. It also records one answer with the TypeScript cache into tests/fixtures/ts-cache, which
// test_cache.py replays from Python. Add a case here and in test_parity.py together; re-run this after changing either side.

import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { check, checks, choose, classify, extractValue, fakeJev, rankByScore, rate, ref, request, requestAll, run, screen } from "question-kit";
import type { Entry, Question, Task } from "question-kit";
import { cacheKey, cachedJev } from "question-kit/cache";

const MESSAGE = 'Hi, order 4410982 was due "last Friday" and it still isn\'t here.\nCall me at (479) 555-0100 or email Ana.Diaz@Example.com 🙂';

type Built = { state: Entry; questions: Record<string, Question> };
const cases: Record<string, Built> = {};
const one = (name: string, task: Task<unknown>, state?: Record<string, never>) => (cases[name] = request(task, state ? { state } : {}));

one("classify/plain", classify(MESSAGE, { shipping: "Where an order is", refund: "Money back for an order" }));
one(
  "classify/specs",
  classify(
    MESSAGE,
    {
      where_is_it: { what: "Asking where an order is.", examples: ["where's my order?", "it was due Friday"], parent: "orders" },
      cancel: { what: "Wants to cancel an order.", not_for: "returning something delivered", examples: ["cancel order 4410982"], parent: "orders" },
      question: { what: "A question about the store.", not_for: "one of their own orders", examples: [] },
    },
    { question: "Which queue should this go to?", none: "Something else.", backoffBelow: 0.9 },
  ),
);
one("classify/no-none", classify("hello", { a: "A", b: "B" }, { none: false }));
one("extractValue/number", extractValue(MESSAGE, { kind: "number", role: "the order number" }));
one("extractValue/email", extractValue(MESSAGE, { kind: "email", role: "the email for the receipt" }));
one("extractValue/phone", extractValue(MESSAGE, { kind: "phone", role: "the phone number" }));
one("extractValue/names", extractValue("dave said hi", { kind: { names: ["David Minh", "Crystal Minh", "none"] }, role: "the customer's name" }));
one("extractValue/regex", extractValue("codes AB-1234 and CD-5678.", { kind: /[A-Z]{2}-\d{4}/g, role: "the code to refund" }));
one("extractValue/empty", extractValue("no numbers here", { kind: "number", role: "the order number" }));
one(
  "screen/flags",
  screen(
    MESSAGE,
    {
      wants_person: { statement: "The customer asks to talk to a person.", action: "person" },
      will_leave: { statement: "The customer says they will stop shopping here.", true: "They say they're leaving.", action: "retain" },
    },
    { precedence: ["person", "retain"], severity: { question: "How upset is the customer?", levels: ["Calm.", "Annoyed.", "Angry."] } },
  ),
);
const LEVELS = ["Unrelated to the query.", "Related, but doesn't answer it.", "Answers part of it.", "Answers it exactly."];
one("rankByScore/query", rankByScore(["Reset it from the login page.", { title: "Shipping", body: "5 to 7 days" }, 42, 2.5, 1e-7, true, null], { query: "how do I reset my password?", levels: LEVELS }));
one("rankByScore/question", rankByScore(["a", "b"], { question: "How formal is it?", levels: [{ level: "casual" }, { level: "formal" }], name: "texts" }));
one("rankByScore/function", rankByScore(["a", "b", "c"], { query: { q: "x" }, question: (item, query) => `Is ${item} a better answer to ${query} than most?`, levels: ["No.", "Yes."] }));
one("check", check(MESSAGE, "The customer is upset.", { true: "Upset.", false: "Calm." }));
one("check/function", check("text here", (t) => `Is ${t} written in English?`));
one(
  "checks",
  checks(MESSAGE, { upset: "The customer is upset.", late: { statement: "The order is late.", true: "It's late." }, whole: (t) => `Does ${t} mention a phone number?` }),
);
one("choose/default", choose(MESSAGE, { a: "Option A", b: { what: "Option B", examples: ["b!"] } }));
one("choose/question", choose(MESSAGE, { a: "A", b: "B" }, { question: (t) => `Pick for ${t}.`, none: false }));
one("rate", rate(MESSAGE, "How urgent is it?", ["Not urgent.", "Somewhat.", "Very."]));
cases["requestAll/triage"] = requestAll(
  {
    intent: classify(ref("message"), { shipping: "Where an order is", refund: "Money back" }, { backoffBelow: 0.9 }),
    order: extractValue(ref("message"), { kind: /\b\d{7}\b/g, role: "the customer's order number", source: MESSAGE }),
    flags: screen(ref("message"), { wants_person: { statement: "The customer asks for a person.", action: "person" } }, { precedence: ["person"] }),
  },
  { state: { message: MESSAGE } },
);
cases["requestAll/shared-text"] = requestAll({
  a: check(MESSAGE, "The customer is upset."),
  b: choose(MESSAGE, { x: "X", y: "Y" }),
  c: rate("other text", "How long is it?", ["Short.", "Long."]),
});

const out = Object.fromEntries(
  Object.entries(cases).map(([name, c]) => [name, { ...c, key: cacheKey({ state: c.state, questions: c.questions }), keyWithModel: cacheKey({ state: c.state, questions: c.questions, model: "jev-1.13.0" }) }]),
);
const path = join(import.meta.dir, "..", "tests", "fixtures", "parity.json");
writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
console.log(`${Object.keys(out).length} cases → ${path}`);

// One answer recorded by the TypeScript cache, for test_cache.py to replay from Python.
const cacheDir = join(import.meta.dir, "..", "tests", "fixtures", "ts-cache");
rmSync(cacheDir, { recursive: true, force: true });
const recorder = cachedJev(
  fakeJev(() => ({ type: "choice", choice: "shipping", probabilities: { shipping: 0.93, refund: 0.05, none: 0.02 } })),
  cacheDir,
);
await run(recorder, classify(MESSAGE, { shipping: "Where an order is", refund: "Money back for an order" }));
console.log(`1 answer recorded → ${cacheDir}`);
