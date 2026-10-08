// The README's "several methods in one request" example, run against a fake client.
import { expect, test } from "bun:test";
import { check, classify, extractDate, extractValue, fakeJev, ref, runAll } from "question-kit";

test("README: several methods in one request", async () => {
  const text = "order 4410982 was supposed to come yesterday, can I talk to someone?";
  const jev = fakeJev((id) => (id === "intent::label" ? "track" : id === "order::value" ? "4410982" : id === "due::mode" ? "relative" : id === "due::anchor" ? "yesterday" : id === "person::check" ? 0.9 : "none"));
  const message = ref("message");
  const r = await runAll(jev, {
    intent: classify(message, { track: "Asking where an order is", cancel: "Wants to cancel" }),
    order: extractValue(message, { kind: "number", role: "the order number", source: text }),
    due: extractDate(message, { role: "the date it was supposed to arrive", today: "2026-10-07" }),
    person: check(message, "The customer asks to talk to a human agent."),
  }, { state: { message: text } });
  expect(jev.requests).toHaveLength(1);
  expect(jev.requests[0]!.state).toEqual({ message: text });
  expect([r.intent.value, r.order.value, r.due.date, r.person.value]).toEqual(["track", "4410982", "2026-10-06", true]);
});
