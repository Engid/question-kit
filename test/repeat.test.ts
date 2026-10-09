import { describe, expect, test } from "bun:test";
import { defineMenu, type OrderItem } from "question-kit/order";
import { type Answer, fakeJev, type Json, type Question } from "question-kit";
import { type Action, type AgentEvent, defineService, type Record_, type ServiceSpec, turn, type TurnInput, view } from "../packages/question-kit/service-agent/index.ts";

// A counter order: the customer adds, changes and removes items until they say they're done, then
// gives a name. The app owns the order (the register below); the agent only decides which tool
// each phrase calls for.

const menu = defineMenu({
  name: "pizza",
  place: "a pizza counter",
  items: { pizza: { words: ["pizza", "pizzas"] }, drink: {} },
  fields: {
    size: { items: ["pizza", "drink"], values: { SMALL: ["small"], MEDIUM: ["medium"], LARGE: ["large"] } },
    topping: { items: ["pizza"], many: true, amounts: true, values: { PEPPERONI: ["pepperoni"], MUSHROOMS: ["mushrooms", "mushroom"], ONIONS: ["onions", "onion"] } },
    drink: { items: ["drink"], names: true, values: { COKE: ["coke"], DIET_COKE: ["diet coke"], WATER: ["water"] } },
  },
});

const spec: ServiceSpec = {
  intents: {
    order: { name: "Order food", description: "The customer wants pizza or drinks.", examples: ["can I get a large pepperoni?"] },
    hours: { name: "Opening hours", description: "The customer asks when we're open.", aside: true },
    menu: { name: "The menu", description: "The customer asks what there is.", aside: true },
  },
  slots: {
    items: { label: "order", menu },
    line: { label: "item", from: "order" },
    name: { label: "name", list: ["Sam Lee", "Ana Ruiz"] },
  },
  tools: {
    "add-items": { description: "add items to the order", needs: ["items"] },
    "change-item": { description: "change an item already on the order", needs: ["line", "items"] },
    "remove-item": { description: "take an item off the order", needs: ["line"] },
    "place-order": { description: "send the order to the kitchen", needs: ["name"], changes: true },
    "show-menu": { description: "show the menu" },
  },
  procedures: {
    order: [{ repeat: ["add-items", "change-item", "remove-item"], ask: "What can I get for you?" }, "place-order"],
    hours: [{ say: "We're open 11am to 11pm every day." }],
    menu: ["show-menu"],
  },
};
const shop = defineService(spec);

/** A made-up register: lines of items, and the current lines after each change. */
function register() {
  const lines: { id: string; item: OrderItem }[] = [];
  let next = 1;
  const text = (it: OrderItem) => `${it.number} ${it.values.size?.toLowerCase() ?? ""} ${it.kind}${(it.lists.topping ?? []).map((t) => ` ${t.not ? "no " : ""}${t.id.toLowerCase()}`).join("")}`.replace(/\s+/g, " ").trim();
  const records = (): Record<string, Record_[]> => ({ order: lines.map((l) => ({ id: l.id, text: text(l.item) })) });
  return {
    lines,
    run(tool: string, values: Record<string, Json>) {
      if (tool === "add-items") {
        for (const it of values.items as unknown as OrderItem[]) lines.push({ id: String(next++), item: it });
        return { ok: true, records: records(), say: `Got it: ${(values.items as unknown as OrderItem[]).map(text).join(" and ")}.` };
      }
      if (tool === "change-item") {
        const line = lines.find((l) => l.id === values.line)!;
        const change = (values.items as unknown as OrderItem[])[0]!;
        Object.assign(line.item.values, change.values);
        for (const [f, cs] of Object.entries(change.lists)) line.item.lists[f] = [...(line.item.lists[f] ?? []).filter((c) => !cs.some((d) => d.id === c.id)), ...cs.filter((c) => !c.not)];
        return { ok: true, records: records(), say: `Changed line ${line.id} to ${text(line.item)}.` };
      }
      if (tool === "remove-item") {
        const i = lines.findIndex((l) => l.id === values.line);
        const [gone] = lines.splice(i, 1);
        return { ok: true, records: records(), say: `Took off ${text(gone!.item)}.` };
      }
      if (tool === "show-menu") return { ok: true, say: "Here's the menu." };
      return { ok: true, note: `Order sent to the kitchen for ${values.name}.` };
    },
  };
}

function sure(q: Question, pick: string, p: number): Answer {
  if (q.type !== "choice") throw new Error("expected a Choice");
  const keys = Object.keys(q.criteria);
  if (!keys.includes(pick)) throw new Error(`"${pick}" isn't an option (${keys.join(", ")})`);
  const rest = (1 - p) / Math.max(1, keys.length - 1);
  return { type: "choice", choice: pick, probabilities: Object.fromEntries(keys.map((k) => [k, k === pick ? p : rest])) };
}

/**
 * Jev, scripted: what each phrase does (by its text), whether a message says the customer is finished,
 * and optionally the check of the order after a change (P(wrong) by line text, and "missing") and
 * whether a reply says the read-back is right.
 */
function scripted(phrases: Record<string, [string, number]>, finished: (message: string) => number, more: { wrong?: (line: string) => number; missing?: (order: Json) => number; right?: (message: string) => number } = {}) {
  return fakeJev((id, q, state) => {
    const st = state as Record<string, Json>;
    if (id === "label") return sure(q, /open|hours/.test(String(st.customer)) ? "hours" : /menu/.test(String(st.customer)) ? "menu" : "order", 0.98);
    if (id.startsWith("tag_w")) return "none";
    const [task] = id.split("::") as [string];
    if (task === "aside") {
      const m = String(st.message ?? String(st.chat).split("\n").at(-1));
      return sure(q, /open|hours/.test(m) ? "hours" : /menu/.test(m) ? "menu" : "none", 0.98);
    }
    if (task === "finished") return { type: "noul", noul: finished(String(st.message)) };
    if (task === "right") return { type: "noul", noul: more.right?.(String(st.message)) ?? 0.05 };
    if (task === "missing") return { type: "noul", noul: more.missing?.(st.order!) ?? 0.02 };
    if (/^i\d+$/.test(task)) return { type: "noul", noul: more.wrong?.((st.order as Record<string, string>)[task]!) ?? 0.02 };
    if (/^p\d+$/.test(task)) {
      const text = (st.phrases as Record<string, string>)[task]!;
      const [pick, p] = phrases[text] ?? ["none", 0.99];
      return sure(q, pick, p);
    }
    if (task === "confirm") return sure(q, "yes", 0.95);
    if (task.startsWith("slot_")) return sure(q, /sam/i.test(String(st.chat)) ? "Sam Lee" : "none", 0.99);
    return { type: "noul", noul: 0.05 };
  });
}

async function chat(messages: string[], phrases: Record<string, [string, number]>, finished: (m: string) => number, more: Parameters<typeof scripted>[2] = {}) {
  const client = scripted(phrases, finished, more);
  const reg = register();
  let log: AgentEvent[] = [];
  const actions: Action[] = [];
  const said: string[] = [];
  for (const text of messages) {
    let input: TurnInput = { type: "customer", text };
    for (;;) {
      const r = await turn(shop, log, input, { client });
      log = r.log;
      actions.push(r.action);
      said.push(...r.messages);
      if (r.action.type !== "call") break;
      input = { type: "result", tool: r.action.tool, step: r.action.step, ...reg.run(r.action.tool, r.action.values) };
    }
    if (view(log).ended) break;
  }
  return { log, actions, said, client, reg, kinds: actions.map((a) => (a.type === "call" ? `call:${a.tool}` : a.type)) };
}

describe("a repeat step", () => {
  test("defineService checks a repeat's tools", () => {
    expect(() => defineService({ ...spec, tools: { ...spec.tools, "add-items": { description: "add", needs: ["items"], changes: true } } })).toThrow(/can't be a change/);
    expect(() => defineService({ ...spec, tools: { ...spec.tools, "add-items": { description: "add", needs: ["items", "name"] } } })).toThrow(/only need menu and from slots/);
    expect(() => defineService({ ...spec, slots: { ...spec.slots, items: { label: "order", menu, list: [] } } })).toThrow(/exactly one of/);
  });

  test("each phrase of a message becomes a call, in order, and the app's replies are said", async () => {
    const r = await chat(["hi, two large pepperoni pizzas and a diet coke"], { "hi two large pepperoni pizzas": ["add-items", 0.99], "and a diet coke": ["add-items", 0.99] }, () => 0.05);
    expect(r.kinds).toEqual(["call:add-items", "call:add-items", "repeat-ask"]);
    const calls = r.actions.filter((a): a is Extract<Action, { type: "call" }> => a.type === "call");
    expect((calls[0]!.values.items as unknown as OrderItem[])[0]).toMatchObject({ kind: "pizza", number: 2, values: { size: "LARGE" } });
    expect((calls[1]!.values.items as unknown as OrderItem[])[0]).toMatchObject({ kind: "drink", number: 1, values: { drink: "DIET_COKE" } });
    expect(r.said).toEqual(["Got it: 2 large pizza pepperoni.", "Got it: 1 drink.", "Anything else?"]);
    // The repeat read is one request after the order kit's tags: one Choice per phrase, plus "finished?".
    const repeat = r.client.requests.find((q) => Object.keys(q.questions).some((k) => k.startsWith("p1::")))!;
    expect(Object.keys(repeat.questions).sort()).toEqual(["aside::label", "finished::check", "p1::label", "p2::label"]);
    expect(Object.keys((repeat.questions["p1::label"] as { criteria: Record<string, unknown> }).criteria)).toEqual(["add-items", "none"]);
  });

  test("with lines on the order, a tool that needs a line gets one option per line", async () => {
    const r = await chat(
      ["a large pepperoni pizza and a coke", "actually make that pizza a medium, and take off the coke"],
      { "a large pepperoni pizza": ["add-items", 0.99], "and a coke": ["add-items", 0.99], "actually make that pizza a medium": ["change-item@1", 0.99], "and take off the coke": ["remove-item@2", 0.99] },
      () => 0.05,
    );
    expect(r.kinds).toEqual(["call:add-items", "call:add-items", "repeat-ask", "call:change-item", "call:remove-item", "repeat-ask"]);
    const second = r.client.requests.filter((q) => "p1::label" in q.questions)[1]!;
    const options = Object.keys((second.questions["p1::label"] as { criteria: Record<string, unknown> }).criteria);
    expect(options).toEqual(["add-items", "change-item@1", "change-item@2", "remove-item@1", "remove-item@2", "none"]);
    expect(second.state).toMatchObject({ order: { "1": "1 large pizza pepperoni", "2": "1 drink" } });
    const change = r.actions.find((a): a is Extract<Action, { type: "call" }> => a.type === "call" && a.tool === "change-item")!;
    expect(change.values.line).toBe("1");
    expect(r.reg.lines.map((l) => l.item.values.size ?? l.item.kind)).toEqual(["MEDIUM"]);
    expect(r.said.at(-1)).toBe("Anything else?");
  });

  test("a message with no items is one phrase, offered only the tools that need none", async () => {
    const r = await chat(["a coke", "take that off"], { "a coke": ["add-items", 0.99], "take that off": ["remove-item@1", 0.99] }, () => 0.05);
    expect(r.kinds).toEqual(["call:add-items", "repeat-ask", "call:remove-item", "repeat-ask"]);
    const second = r.client.requests.filter((q) => "p1::label" in q.questions)[1]!;
    expect(Object.keys((second.questions["p1::label"] as { criteria: Record<string, unknown> }).criteria)).toEqual(["remove-item@1", "none"]);
  });

  test("\"that's all\" ends the repeat, even with an item in the same message, and the procedure goes on", async () => {
    const r = await chat(["two medium pizzas", "and a water, that's all", "Sam Lee", "yes"], { "two medium pizzas": ["add-items", 0.99], "and a water": ["add-items", 0.99] }, (m) => (/that's all/.test(m) ? 0.95 : 0.05));
    expect(r.kinds).toEqual(["call:add-items", "repeat-ask", "call:add-items", "ask", "confirm", "call:place-order", "wrap-up"]);
    expect(r.said).toContain("Could I have your name?");
    expect(r.said.some((m) => m.startsWith("Just to confirm, I'll send the order to the kitchen (name: Sam Lee)"))).toBe(true);
  });

  test("a message that calls for nothing is asked again, then handed off", async () => {
    const r = await chat(["a coke", "hmm", "uh"], { "a coke": ["add-items", 0.99] }, () => 0.05);
    expect(r.kinds).toEqual(["call:add-items", "repeat-ask", "repeat-ask", "handoff"]);
    expect(r.said).toContain("Sorry, I didn't catch that. Anything else?");
  });

  test("an unsure pick isn't acted on; the repeat gate is 0.7", async () => {
    const r = await chat(["a coke", "a water"], { "a coke": ["add-items", 0.99], "a water": ["add-items", 0.6] }, () => 0.05);
    expect(r.kinds).toEqual(["call:add-items", "repeat-ask", "repeat-ask"]);
    expect(r.reg.lines.length).toBe(1);
    expect(shop.gates.repeat).toBe(0.7);
  });

  test("after a phrase removes a line, changing that line and adding count as one pick", async () => {
    // "make it a water" splits 0.55 change-line-1 / 0.44 add: unsure apart, sure together.
    const client = fakeJev((id, q, state) => {
      const st = state as Record<string, Json>;
      if (id === "label") return sure(q, "order", 0.98);
      if (id.startsWith("tag_w")) return "none";
      const [task] = id.split("::") as [string];
      if (task === "finished") return { type: "noul", noul: 0.05 };
      if (task === "aside") return sure(q, "none", 0.99);
      if (task === "p1") return sure(q, (st.phrases as Record<string, string>).p1 === "a coke" ? "add-items" : "remove-item@1", 0.99);
      if (task === "p2") {
        const keys = Object.keys((q as { criteria: Record<string, unknown> }).criteria);
        return { type: "choice", choice: "change-item@1", probabilities: Object.fromEntries(keys.map((k) => [k, k === "change-item@1" ? 0.55 : k === "add-items" ? 0.44 : 0.01 / (keys.length - 2)])) };
      }
      return { type: "noul", noul: 0.05 };
    });
    const reg = register();
    let log: AgentEvent[] = [];
    const kinds: string[] = [];
    for (const text of ["a coke", "scratch the coke, make it a water"]) {
      let input: TurnInput = { type: "customer", text };
      for (;;) {
        const r = await turn(shop, log, input, { client });
        log = r.log;
        kinds.push(r.action.type === "call" ? `call:${r.action.tool}` : r.action.type);
        if (r.action.type !== "call") break;
        input = { type: "result", tool: r.action.tool, step: r.action.step, ...reg.run(r.action.tool, r.action.values) };
      }
    }
    expect(kinds).toEqual(["call:add-items", "repeat-ask", "call:remove-item", "call:add-items", "repeat-ask"]);
    const read = log.filter((e): e is Extract<AgentEvent, { type: "read-repeat" }> => e.type === "read-repeat").at(-1)!;
    expect(read.phrases.map((p) => [p.tool, p.outcome])).toEqual([["remove-item", "act"], ["add-items", "act"]]);
    expect(read.phrases[1]!.confidence).toBeGreaterThan(0.95);
    expect(reg.lines.map((l) => l.item.values.drink)).toEqual(["WATER"]);
  });

  test("an aside at the start is answered, then the agent asks what they need", async () => {
    const r = await chat(["when are you open?", "a coke"], { "a coke": ["add-items", 0.99] }, () => 0.05);
    expect(r.kinds).toEqual(["ask-intent", "call:add-items", "repeat-ask"]);
    expect(r.said.slice(0, 2)).toEqual(["We're open 11am to 11pm every day.", "How can I help you today?"]);
    expect(r.log.filter((e) => e.type === "read-intent").length).toBe(1);
  });

  test("an aside mid-order is answered and the order carries on, with no miss counted", async () => {
    const r = await chat(["a coke", "what's on the menu?", "and a water"], { "a coke": ["add-items", 0.99], "and a water": ["add-items", 0.99] }, () => 0.05);
    expect(r.kinds).toEqual(["call:add-items", "repeat-ask", "call:show-menu", "repeat-ask", "call:add-items", "repeat-ask"]);
    expect(r.said.slice(2, 4)).toEqual(["Here's the menu.", "Anything else?"]);
    const calls = r.actions.filter((a): a is Extract<Action, { type: "call" }> => a.type === "call");
    expect(calls[1]).toMatchObject({ tool: "show-menu", aside: "menu" });
    expect(view(r.log).misses).toEqual({});
    // The aside question rides along in the repeat request.
    const second = r.client.requests.filter((q) => "p1::label" in q.questions)[1]!;
    expect(Object.keys(second.questions)).toContain("aside::label");
  });

  test("defineService checks an aside's steps", () => {
    expect(() => defineService({ ...spec, procedures: { ...spec.procedures, hours: ["place-order"] } })).toThrow(/is an aside/);
  });

  test("after a message's calls, Jev checks the order; nothing wrong means no read-back", async () => {
    const r = await chat(["a coke"], { "a coke": ["add-items", 0.99] }, () => 0.05);
    expect(r.kinds).toEqual(["call:add-items", "repeat-ask"]);
    const check = r.client.requests.find((q) => "missing::check" in q.questions)!;
    expect(Object.keys(check.questions).sort()).toEqual(["i1::check", "missing::check"]);
    expect(check.state).toMatchObject({ order: { i1: "1 drink" } });
    const review = r.log.find((e): e is Extract<AgentEvent, { type: "read-review" }> => e.type === "read-review")!;
    expect(review).toMatchObject({ doubt: false, missing: 0.02, wrong: [{ text: "1 drink", p: 0.02 }] });
  });

  test("a doubt reads the whole order back; \"yes\" goes on, a correction is read as usual", async () => {
    const wrong = (line: string) => (line.includes("large") ? 0.6 : 0.02);
    const r = await chat(
      ["two large pepperoni pizzas", "yes", "actually make that a medium", "yes that's all"],
      { "two large pepperoni pizzas": ["add-items", 0.99], "actually make that a medium": ["change-item@1", 0.99] },
      (m) => (/that's all/.test(m) ? 0.95 : 0.05),
      { wrong, right: (m) => (/^yes/.test(m) ? 0.95 : 0.05) },
    );
    expect(r.kinds).toEqual(["call:add-items", "repeat-check", "repeat-ask", "call:change-item", "repeat-ask", "ask"]);
    expect(r.said[1]).toBe("So that's 2 large pizza pepperoni. Is that right?");
    expect(r.said[2]).toBe("Anything else?");
    // The second check (medium) didn't doubt; "yes that's all" read as finished.
    expect(r.said.at(-1)).toBe("Could I have your name?");
  });

  test("\"no\" without a change asks what it should be; a reply that corrects skips the question", async () => {
    let checks = 0;
    const r = await chat(
      ["two large pepperoni pizzas", "no", "make it one large", "yes"],
      { "two large pepperoni pizzas": ["add-items", 0.99], "make it one large": ["change-item@1", 0.99] },
      () => 0.05,
      { wrong: () => (checks++ === 0 ? 0.5 : 0.02), right: (m) => (/^yes/.test(m) ? 0.95 : 0.05) },
    );
    expect(r.kinds).toEqual(["call:add-items", "repeat-check", "repeat-ask", "call:change-item", "repeat-ask", "repeat-ask"]);
    expect(r.said[2]).toBe("Sorry about that. What should it be?");
  });

  test("readBackAt 1 turns the check off", async () => {
    const quiet = defineService({ ...spec, readBackAt: 1 });
    const client = scripted({ "a coke": ["add-items", 0.99] }, () => 0.05, { wrong: () => 0.9 });
    let r = await turn(quiet, [], { type: "customer", text: "a coke" }, { client });
    r = await turn(quiet, r.log, { type: "result", tool: "add-items", step: r.action.type === "call" ? r.action.step : 0, ok: true, records: { order: [{ id: "1", text: "1 coke" }] } }, { client });
    expect(r.action.type).toBe("repeat-ask");
    expect(client.requests.some((q) => "missing::check" in q.questions)).toBe(false);
  });
});

