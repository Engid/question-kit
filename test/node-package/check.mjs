// Run by run.sh in a folder where the packed question-kit is installed: plain Node, no Bun, no
// TypeScript. Exits non-zero on the first failure.

import http from "node:http";
import assert from "node:assert/strict";
import { classify, fakeJev, run } from "question-kit";
import { cachedJev } from "question-kit/cache";
import { jsonlRecorder } from "question-kit/node";
import { typesafeJev } from "question-kit/typesafe";
import { openRouter } from "question-kit/experimental/openrouter";
import { takeOrder } from "question-kit/order";
import { defineService } from "question-kit/service-agent";

for (const [name, f] of Object.entries({ cachedJev, jsonlRecorder, typesafeJev, openRouter, takeOrder, defineService })) {
  assert.equal(typeof f, "function", `${name} is exported`);
}
console.log("ok  every entry imports");

const labels = { billing: "About charges or refunds", login: "About signing in" };
const answer = (q) =>
  q.type === "noul"
    ? { type: "noul", noul: 0.9 }
    : { type: q.type, [q.type]: Object.keys(q.criteria)[0], confidence: 0.9, probabilities: Object.fromEntries(Object.keys(q.criteria).map((k, i) => [k, i ? 0.1 / (Object.keys(q.criteria).length - 1) : 0.9])) };

const fake = await run(fakeJev((_id, q) => answer(q)), classify("I was charged twice", labels));
assert.equal(fake.value, "billing");
console.log("ok  classify on a fake client");

// A stand-in for TypeSafe's and OpenRouter's APIs: answers every question with its first option.
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const { questions, model } = JSON.parse(body);
    const answers = Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, answer(q)]));
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ model: model ?? "stand-in", answers, usage: { input_tokens: 10, output_tokens: 0 } }));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const root = `http://127.0.0.1:${server.address().port}`;
try {
  const viaTypesafe = await run(typesafeJev({ apiKey: "test", baseURL: root, pace: false, onRetry: false }), classify("I was charged twice", labels));
  assert.equal(viaTypesafe.value, "billing");
  console.log("ok  typesafeJev, through TypeSafe's SDK, to a stand-in server");

  const viaOpenRouter = await run(openRouter({ apiKey: "test", model: "typesafe/jev-1.13", baseURL: `${root}/api`, onRetry: false }), classify("I was charged twice", labels));
  assert.equal(viaOpenRouter.value, "billing");
  console.log("ok  openRouter, to a stand-in server");
} finally {
  server.close();
}
