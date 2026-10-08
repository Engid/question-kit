// service-agent: the turn logic, with a scripted stand-in for Jev (no network).

import { describe, expect, test } from "bun:test";
import { type Answer, fakeJev, type JevRequest, memoryRecorder, type Question } from "question-kit";
import { type Action, type AgentEvent, defineService, roleOf, type ServiceSpec, transcript, turn, type TurnInput, view } from "../packages/service-agent/index.ts";

const spec: ServiceSpec = {
  intents: {
    refund: { name: "Refund", description: "The customer wants money back for an order.", examples: ["I want a refund"] },
    slow: { name: "Website slow", description: "The site is slow for the customer." },
    password: { name: "Reset password" },
    fee: { name: "Unexpected fee", procedure: "Check the account. If the fee was our mistake, refund it; otherwise tell the web team." },
  },
  slots: {
    name: { label: "full name", list: ["Crystal Minh", "Joyce Wu"] },
    account_id: { label: "account ID", pattern: /\b[A-Z0-9]{10}\b/g },
    order_id: { label: "order ID", pattern: /\b\d{10}\b/g },
    amount: { label: "refund amount", pattern: "amount" },
    method: { label: "refund method", options: { card: "back to the card", credit: "store credit" } },
    team: { label: "team", options: { web: "website team", buying: "purchasing" } },
  },
  tools: {
    "pull-up": { description: "pull up the account", needs: [{ anyOf: ["name", "account_id"] }] },
    validate: { description: "check the order", needs: ["order_id"] },
    refund: { description: "refund the order", needs: ["amount", "method"], changes: true },
    "log-out-in": { description: "have them log out and in", instruction: "log out and back in" },
    cookies: { description: "have them clear cookies", instruction: "clear your cookies" },
    notify: { description: "tell a team", needs: ["team"] },
    reset: { description: "send a reset link" },
    "check-fee": { name: "Check Fee", description: "look up whether the fee was our mistake" },
  },
  procedures: {
    refund: ["pull-up", "validate", "refund"],
    slow: [{ try: ["log-out-in", "cookies"] }, { tool: "notify", fixed: { team: "web" } }],
    password: ["pull-up", "reset"],
    fee: ["pull-up", "check-fee", { optional: ["refund", { tool: "notify", fixed: { team: "web" } }] }],
  },
};
const service = defineService(spec);

/** Answers scripted per kind of question, sure by default. */
interface Script {
  intent?: (customer: string) => [string, number];
  slot?: (slot: string, chat: string, options: string[]) => [string, number];
  /** "fixed" or "value" (a checked value); also "confirm" when `confirm` isn't given (yes above 0.5, else no). */
  yesNo?: (about: string, chat: string) => number;
  confirm?: (chat: string) => ["yes" | "correct" | "no", number];
  policy?: (options: string[], chat: string, state: Record<string, string>) => [string, number];
}

function sure(q: Question, pick: string, p: number): Answer {
  if (q.type !== "choice") throw new Error("expected a Choice");
  const keys = Object.keys(q.criteria);
  if (!keys.includes(pick)) throw new Error(`"${pick}" isn't an option (${keys.join(", ")})`);
  const rest = (1 - p) / Math.max(1, keys.length - 1);
  return { type: "choice", choice: pick, probabilities: Object.fromEntries(keys.map((k) => [k, k === pick ? p : rest])) };
}

function scripted(script: Script) {
  return fakeJev((id, q, state) => {
    const st = state as Record<string, string>;
    if (id === "label") {
      const [pick, p] = script.intent?.(st.customer ?? st.chat ?? "") ?? ["none", 0.99];
      return sure(q, pick, p);
    }
    const [task] = id.split("::") as [string];
    if (task.startsWith("slot_")) {
      const opts = q.type === "choice" ? Object.keys(q.criteria) : [];
      const [pick, p] = script.slot?.(task.slice(5), st.chat ?? "", opts) ?? ["none", 0.99];
      return sure(q, pick, p);
    }
    if (task === "confirm") {
      const [pick, p] = script.confirm?.(st.chat ?? "") ?? ((script.yesNo?.("confirm", st.chat ?? "") ?? 0.5) > 0.5 ? ["yes", 0.95] : ["no", 0.95]);
      return sure(q, pick, p);
    }
    if (task === "policy") {
      const [pick, p] = script.policy?.(Object.keys((q as { criteria: Record<string, unknown> }).criteria), st.chat ?? "", st) ?? ["none", 0.99];
      return sure(q, pick, p);
    }
    return { type: "noul", noul: script.yesNo?.(task.split("_")[0]!, st.chat ?? "") ?? 0.5 };
  });
}

/** Run a chat: each customer message, then any tool calls (all succeed), until the agent waits or ends. */
async function chat(messages: string[], script: Script, opts: { failTool?: string; service?: typeof service } = {}) {
  const svc = opts.service ?? service;
  const jev = scripted(script);
  let log: AgentEvent[] = [];
  const actions: Action[] = [];
  for (const text of messages) {
    let input: TurnInput = { type: "customer", text };
    for (;;) {
      const r = await turn(svc, log, input, { jev });
      log = r.log;
      actions.push(r.action);
      if (r.action.type !== "call") break;
      input = { type: "result", tool: r.action.tool, step: r.action.step, ok: r.action.tool !== opts.failTool };
    }
    if (view(log).ended) break;
  }
  return { log, actions, jev, kinds: actions.map((a) => (a.type === "ask" ? `ask:${a.slots.join("+")}` : a.type === "call" ? `call:${a.tool}` : a.type)) };
}

/** A slot answer: the candidate the text holds, or none. */
const found = (pairs: Record<string, RegExp>) => (slot: string, chat: string, options: string[]): [string, number] => {
  const re = pairs[slot];
  const m = re ? chat.match(re)?.[0] : undefined;
  if (m && options.includes(m)) return [m, 0.99];
  return ["none", 0.99];
};

describe("defineService", () => {
  test("checks that the parts refer to each other", () => {
    expect(() => defineService({ ...spec, procedures: { ...spec.procedures, refund: ["nope"] } })).toThrow(/unknown tool "nope"/);
    expect(() => defineService({ ...spec, slots: { ...spec.slots, bad: { label: "bad" } } })).toThrow(/exactly one of/);
    expect(() => defineService({ ...spec, procedures: { slow: spec.procedures.slow!, password: spec.procedures.password! } })).toThrow(/"refund" has no procedure/);
    expect(service.steps.slow!.map((s) => [s.tool, s.group])).toEqual([["log-out-in", 1], ["cookies", 1], ["notify", undefined]]);
    expect(service.steps.fee!.map((s) => [s.tool, s.optional])).toEqual([["pull-up", undefined], ["check-fee", undefined], ["refund", 1], ["notify", 1]]);
  });
});

describe("turn", () => {
  test("a refund, start to finish: values already given aren't asked for", async () => {
    const r = await chat(["hi, I want a refund for order 1234567890", "Crystal Minh", "$40 please", "back to my card", "yes"], {
      intent: (c) => (c.includes("refund") ? ["refund", 0.98] : ["none", 0.99]),
      slot: (slot, chat, options) => {
        if (slot === "name" && chat.includes("Crystal Minh")) return ["Crystal Minh", 0.97];
        if (slot === "method" && chat.includes("card")) return ["card", 0.95];
        return found({ order_id: /\d{10}/, amount: /\$40/ })(slot, chat, options);
      },
      yesNo: (about) => (about === "confirm" ? 0.95 : 0.5),
    });
    // The refund needs two values: asked for together, then the missing one again.
    expect(r.kinds).toEqual(["ask:name", "call:pull-up", "call:validate", "ask:amount+method", "ask:method", "confirm", "call:refund", "wrap-up"]);
    const both = r.actions[3];
    expect(both && "text" in both ? both.text : "").toBe("Could I have your refund amount and refund method?");
    const refund = r.actions.find((a) => a.type === "call" && a.tool === "refund");
    expect(refund).toMatchObject({ values: { amount: "40", method: "card" } });
    const confirm = r.actions.find((a) => a.type === "confirm");
    expect(confirm && "text" in confirm ? confirm.text : "").toContain("refund amount: 40");
    // The order ID came from the first message; the agent never asked for it.
    expect(r.kinds).not.toContain("ask:order_id");
  });

  test("the log is plain JSON: the view rebuilt from a stored copy is the same", async () => {
    const r = await chat(["I want a refund", "Joyce Wu"], {
      intent: () => ["refund", 0.98],
      slot: (slot, chat) => (slot === "name" && chat.includes("Joyce") ? ["Joyce Wu", 0.97] : ["none", 0.99]),
    });
    const stored = JSON.parse(JSON.stringify(r.log)) as AgentEvent[];
    expect(view(stored)).toEqual(view(r.log));
    expect(view(stored).slots.name?.value).toBe("Joyce Wu");
  });

  test("a reply to 'is this about X or Y?' is read against just those", async () => {
    const r = await chat(["um, it's about my thing", "the refund one"], {
      intent: (text) => (text.includes("the refund one") ? ["refund", 0.97] : ["refund", 0.4]),
      slot: () => ["none", 0.99],
    });
    expect(r.kinds).toEqual(["clarify", "ask:name"]);
    const second = r.jev.requests[1]!;
    expect(Object.keys((second.questions.label as { criteria: Record<string, unknown> }).criteria)).toEqual(["refund", "slow", "password", "none"]);
    expect(Object.keys(second.state as Record<string, string>)).toEqual(["chat"]);
  });

  test("a reply naming none of the offered intents is read against all of them", async () => {
    // Offered refund / slow / password; the customer says it's something else. The narrow read says
    // "none", so the agent reads everything the customer said against every intent.
    const jev = fakeJev((id, q, state) => {
      const st = state as Record<string, string>;
      const keys = q.type === "choice" ? Object.keys(q.criteria) : [];
      if (id === "label" && st.chat !== undefined) return sure(q, "none", 0.99);
      if (id === "label") return sure(q, (st.customer ?? "").includes("password") ? "password" : "refund", (st.customer ?? "").includes("password") ? 0.97 : 0.4);
      return sure(q, keys.includes("none") ? "none" : keys[0]!, 0.99);
    });
    let r = await turn(service, [], { type: "customer", text: "it's about my account" }, { jev });
    expect(r.action.type).toBe("clarify");
    r = await turn(service, r.log, { type: "customer", text: "no, I forgot my password" }, { jev });
    expect(r.view.intent).toBe("password");
    expect(jev.requests.map((x) => Object.keys(x.state as Record<string, string>)[0])).toEqual(["customer", "chat", "customer", "chat"]);
  });

  test("a value Jev isn't sure of is checked with the customer", async () => {
    const r = await chat(["I want a refund", "Joyce Wu", "1234567890 and some text"], {
      intent: () => ["refund", 0.98],
      slot: (slot, chat, options) => {
        if (slot === "name") return chat.includes("Joyce") ? ["Joyce Wu", 0.97] : ["none", 0.99];
        if (slot === "order_id" && options.includes("1234567890")) return ["1234567890", 0.6];
        return ["none", 0.99];
      },
      yesNo: (about, chat) => (about === "value" && chat.endsWith("1234567890 and some text") ? 0.5 : 0.95),
    });
    expect(r.kinds).toEqual(["ask:name", "call:pull-up", "ask:order_id", "check-value"]);
    const check = r.actions.at(-1);
    expect(check && "text" in check ? check.text : "").toBe("Just to check, is your order ID 1234567890?");
    const yes = await turn(service, r.log, { type: "customer", text: "yes" }, { jev: r.jev });
    expect(yes.action).toMatchObject({ type: "call", tool: "validate", values: { order_id: "1234567890" } });
  });

  test("a correction to a read-back is read again, and read back again", async () => {
    const r = await chat(["refund 1234567890, Crystal Minh, $40 back to my card", "no, make it store credit", "yes"], {
      intent: () => ["refund", 0.98],
      slot: (slot, chat, options) => {
        if (slot === "name") return ["Crystal Minh", 0.97];
        if (slot === "method") return chat.includes("store credit") ? ["credit", 0.97] : ["card", 0.97];
        return found({ order_id: /\d{10}/, amount: /\$40/ })(slot, chat, options);
      },
      confirm: (chat) => (chat.endsWith("customer: yes") ? ["yes", 0.97] : ["correct", 0.95]),
    });
    expect(r.kinds).toEqual(["call:pull-up", "call:validate", "confirm", "confirm", "call:refund", "wrap-up"]);
    expect(r.actions.find((a) => a.type === "call" && a.tool === "refund")).toMatchObject({ values: { amount: "40", method: "credit" } });
  });

  test("optional steps: Jev picks from the procedure and what the tools found, then picks again", async () => {
    const seen: Record<string, string>[] = [];
    const jev = scripted({
      intent: () => ["fee", 0.97],
      slot: (slot) => (slot === "name" ? ["Crystal Minh", 0.97] : ["none", 0.99]),
      policy: (options, chat, state) => {
        seen.push(state);
        // First pick: the web team (the system said it wasn't our mistake); then nothing more.
        return options.includes("notify") && chat.includes("not our mistake") ? ["notify", 0.95] : ["none", 0.97];
      },
    });
    let r = await turn(service, [], { type: "customer", text: "Crystal Minh here, why was I charged a fee?" }, { jev });
    expect(r.action).toMatchObject({ type: "call", tool: "pull-up" });
    r = await turn(service, r.log, { type: "result", tool: "pull-up", step: 0, ok: true }, { jev });
    expect(r.action).toMatchObject({ type: "call", tool: "check-fee" });
    r = await turn(service, r.log, { type: "result", tool: "check-fee", step: 1, ok: true, note: "Check Fee: not our mistake." }, { jev });
    expect(r.action).toMatchObject({ type: "call", tool: "notify", values: { team: "web" } });
    expect(transcript(r.log)).toContain("system: Check Fee: not our mistake.");
    expect(seen[0]).toMatchObject({ request: "Unexpected fee", procedure: spec.intents.fee!.procedure, steps_done: "1. pull-up (full name: Crystal Minh)\n2. Check Fee" });
    r = await turn(service, r.log, { type: "result", tool: "notify", step: 3, ok: true }, { jev });
    // Second round: only the refund is left, and Jev says none.
    expect(r.action.type).toBe("wrap-up");
    expect(r.view.policy.size).toBe(2);
    expect(seen[1]?.steps_done).toBe("1. pull-up (full name: Crystal Minh)\n2. Check Fee\n3. notify (team: web)");
  });

  test("optional steps Jev isn't sure of: a change is offered (read back), anything else is skipped", async () => {
    const run = async (lean: string, svc = service) => {
      const jev = scripted({
        intent: () => ["fee", 0.97],
        slot: (slot) => (slot === "name" ? ["Crystal Minh", 0.97] : slot === "amount" ? ["$40", 0.97] : slot === "method" ? ["card", 0.97] : ["none", 0.99]),
        // Leans toward one option, under the 0.9 gate (0.8 vs 0.1 and 0.1: confidence 0.7).
        policy: (options) => (options.includes(lean) ? [lean, 0.8] : ["none", 0.99]),
        confirm: () => ["no", 0.97],
      });
      let r = await turn(svc, [], { type: "customer", text: "Crystal Minh, $40 back to my card, why was I charged a fee?" }, { jev });
      r = await turn(svc, r.log, { type: "result", tool: "pull-up", step: 0, ok: true }, { jev });
      r = await turn(svc, r.log, { type: "result", tool: "check-fee", step: 1, ok: true }, { jev });
      return r;
    };
    // The refund is a change: offered, so the customer decides.
    let r = await run("refund");
    expect(r.action).toMatchObject({ type: "confirm", tool: "refund" });
    expect([...r.view.policy.values()][0]).toMatchObject({ outcome: "unsure" });
    // Turned down: listed in the steps done, and Jev picks again from what's left.
    const after = await turn(service, r.log, { type: "customer", text: "no thanks" }, { jev: scripted({ policy: (_o, _c, st) => (st.steps_done?.includes("Offered refund: the customer turned it down") ? ["none", 0.99] : ["notify", 0.99]) }) });
    expect(after.action.type).toBe("wrap-up");
    // Telling a team isn't a change: not done on a guess.
    r = await run("notify");
    expect(r.action.type).toBe("wrap-up");
    // With offerWhenUnsure off, the refund isn't offered either.
    r = await run("refund", defineService({ ...spec, offerWhenUnsure: false }));
    expect(r.action.type).toBe("wrap-up");
  });

  test("anything else? A step passed over is picked again with the reply; finished ends; more than the procedure hands off", async () => {
    const seen: string[] = [];
    const script: Script = {
      intent: () => ["fee", 0.97],
      slot: (slot, chat) => (slot === "name" ? ["Crystal Minh", 0.97] : slot === "amount" && chat.includes("$40") ? ["$40", 0.97] : slot === "method" && chat.includes("card") ? ["card", 0.97] : ["none", 0.99]),
      // The procedure: refund only if the customer is still unhappy. Before they say so, none.
      policy: (options, chat) => {
        seen.push(chat.split("\n").at(-1) ?? "");
        return chat.includes("still not happy") && options.includes("refund") ? ["refund", 0.95] : ["none", 0.99];
      },
      yesNo: (about, chat) => {
        const last = chat.split("\n").at(-1) ?? "";
        if (about === "more") return last.includes("that's all") ? 0.03 : last.includes("hmm") ? 0.5 : 0.97;
        return 0.95;
      },
      confirm: () => ["yes", 0.97],
    };
    const opening = "Crystal Minh, why was I charged a fee? $40 back to my card";
    // Finished: goodbye.
    let r = await chat([opening, "No, that's all, thanks."], script);
    expect(r.kinds).toEqual(["call:pull-up", "call:check-fee", "wrap-up", "done"]);
    expect(view(r.log).ended?.how).toBe("done");
    // Still unhappy: the refund is picked again with that in view, read back, made, then anything else?
    seen.length = 0;
    r = await chat([opening, "I'm still not happy about this fee.", "yes", "No, that's all."], script);
    expect(r.kinds).toEqual(["call:pull-up", "call:check-fee", "wrap-up", "confirm", "call:refund", "wrap-up", "done"]);
    // Picked twice: when the procedure got there (none), and again with the customer's reply as the last line.
    expect(seen[0]).not.toContain("still not happy");
    expect(seen[1]).toBe("customer: I'm still not happy about this fee.");
    // Wants something the procedure doesn't do: a person.
    r = await chat([opening, "Can you also change my address?"], script);
    expect(r.kinds.at(-1)).toBe("handoff");
    expect(r.actions.at(-1)).toMatchObject({ reason: "the customer wants something the procedure doesn't cover" });
    // Not clear: asked once more, then goodbye.
    r = await chat([opening, "hmm", "hmm"], script);
    expect(r.kinds).toEqual(["call:pull-up", "call:check-fee", "wrap-up", "wrap-up", "done"]);
    const again = r.actions[3];
    expect(again && "text" in again ? again.text : "").toBe("Sorry, is there anything else I can help you with?");
  });

  test("a say step: the company's words go out with the next message, and Jev picks with them in view", async () => {
    const said = "Fees like this are set by our billing system.";
    const svc = defineService({ ...spec, procedures: { ...spec.procedures, fee: ["pull-up", { say: said }, "check-fee", { optional: ["refund"] }] } });
    const states: Record<string, string>[] = [];
    const jev = scripted({
      intent: () => ["fee", 0.97],
      slot: (slot) => (slot === "name" ? ["Crystal Minh", 0.97] : ["none", 0.99]),
      policy: (_o, _c, st) => {
        states.push(st);
        return ["none", 0.99];
      },
    });
    let r = await turn(svc, [], { type: "customer", text: "Crystal Minh, why was I charged a fee?" }, { jev });
    expect(r.action).toMatchObject({ type: "call", tool: "pull-up" });
    r = await turn(svc, r.log, { type: "result", tool: "pull-up", step: 0, ok: true }, { jev });
    // Said, then on to the next step in the same turn.
    expect(r.messages).toEqual([said]);
    expect(r.action).toMatchObject({ type: "call", tool: "check-fee" });
    r = await turn(svc, r.log, { type: "result", tool: "check-fee", step: 2, ok: true }, { jev });
    expect(r.action.type).toBe("wrap-up");
    expect(states[0]?.chat).toContain(`agent: ${said}`);
    expect(states[0]?.steps_done).toContain(`Said: "${said}"`);
  });

  test("a note the customer can't give values for is passed over; a change can't be", async () => {
    const tools = { ...spec.tools, note: { name: "Note Reason", description: "record why they called", needs: ["reason"], skipIfMissing: true } };
    const slots = { ...spec.slots, reason: { label: "reason", options: { late: "late delivery" } } };
    const svc = defineService({ ...spec, tools, slots, procedures: { ...spec.procedures, password: ["pull-up", "note", "reset"] } });
    const r = await chat(["reset my password, I'm Joyce Wu", "dunno", "no idea"], {
      intent: () => ["password", 0.97],
      slot: (slot, chat) => (slot === "name" && chat.includes("Joyce") ? ["Joyce Wu", 0.97] : ["none", 0.99]),
    }, { service: svc });
    expect(r.kinds).toEqual(["call:pull-up", "ask:reason", "ask:reason", "call:reset", "wrap-up"]);
    expect(r.log.some((e) => e.type === "skip" && e.tool === "note")).toBe(true);
    expect(() => defineService({ ...spec, tools: { ...spec.tools, refund: { ...spec.tools.refund!, skipIfMissing: true } } })).toThrow(/can't be skipIfMissing/);
  });

  test("a value's format goes in the question", () => {
    expect(roleOf({ label: "order ID", format: "10 digits", pattern: /\d{10}/g })).toBe("the customer's order ID (10 digits)");
    expect(roleOf({ label: "payment method", options: { card: "card" } }, "the new payment method the customer wants")).toBe("the new payment method the customer wants");
  });

  test("not sure of the intent: offers the likeliest, then hands off", async () => {
    const r = await chat(["um, it's about my thing", "the thing", "you know"], { intent: () => ["refund", 0.4] });
    expect(r.kinds).toEqual(["clarify", "clarify", "handoff"]);
    const c = r.actions[0];
    expect(c?.type === "clarify" ? c.intents[0] : "").toBe("refund");
    expect(c && "text" in c ? c.text : "").toMatch(/^Just to check/);
  });

  test("an opening with no request asks what they need", async () => {
    const r = await chat(["hi there", "my site is slow"], { intent: (c) => (c.includes("slow") ? ["slow", 0.97] : ["none", 0.99]), yesNo: () => 0.5 });
    expect(r.kinds.slice(0, 2)).toEqual(["ask-intent", "call:log-out-in"]);
  });

  test("a value it can't get: asks again, tries the alternative, then hands off", async () => {
    const r = await chat(["reset my password", "dunno", "no idea", "nope", "can't say"], { intent: () => ["password", 0.97] });
    expect(r.kinds).toEqual(["ask:name", "ask:name", "ask:account_id", "ask:account_id", "handoff"]);
    const again = r.actions[1];
    expect(again?.type === "ask" && again.again).toBe(true);
    const last = r.actions.at(-1);
    expect(last?.type === "handoff" ? last.reason : "").toMatch(/account ID/);
  });

  test("troubleshooting: try each fix until one works, then carry on with fixed values", async () => {
    const r = await chat(["the website is really slow", "still slow", "ok that worked"], {
      intent: () => ["slow", 0.97],
      yesNo: (about, chat) => (about === "fixed" ? (chat.endsWith("that worked") ? 0.95 : 0.05) : 0.5),
    });
    expect(r.kinds).toEqual(["call:log-out-in", "ask-fixed", "call:cookies", "ask-fixed", "call:notify", "wrap-up"]);
    expect(r.actions.find((a) => a.type === "call" && a.tool === "notify")).toMatchObject({ values: { team: "web" } });
    const ask = r.actions[1];
    expect(ask && "text" in ask ? ask.text : "").toBe("Could you log out and back in, and let me know if that fixes it?");
  });

  test("a change the customer turns down isn't made; a failed tool hands off", async () => {
    const base = {
      intent: () => ["refund", 0.98] as [string, number],
      slot: (slot: string, chat: string, options: string[]): [string, number] =>
        slot === "name" ? ["Crystal Minh", 0.97] : slot === "method" ? ["credit", 0.95] : found({ order_id: /\d{10}/, amount: /\$40/ })(slot, chat, options),
    };
    const no = await chat(["refund 1234567890, Crystal Minh, $40 as store credit", "no, don't"], { ...base, yesNo: () => 0.03 });
    expect(no.kinds).toEqual(["call:pull-up", "call:validate", "confirm", "wrap-up"]);
    const failed = await chat(["refund 1234567890, Crystal Minh, $40 as store credit"], { ...base }, { failTool: "validate" });
    expect(failed.kinds).toEqual(["call:pull-up", "call:validate", "handoff"]);
  });

  test("a tool's result can fill values the customer wasn't asked for", async () => {
    const jev = scripted({ intent: () => ["refund", 0.98], slot: (slot, chat) => (slot === "name" ? ["Crystal Minh", 0.97] : found({ order_id: /\d{10}/ })(slot, chat, [chat.match(/\d{10}/)?.[0] ?? "none", "none"])), yesNo: () => 0.95 });
    let r = await turn(service, [], { type: "customer", text: "Crystal Minh, refund for 1234567890" }, { jev });
    expect(r.action).toMatchObject({ type: "call", tool: "pull-up" });
    r = await turn(service, r.log, { type: "result", tool: "pull-up", step: 0, ok: true, values: { amount: "64" } }, { jev });
    expect(r.action).toMatchObject({ type: "call", tool: "validate" });
    r = await turn(service, r.log, { type: "result", tool: "validate", step: 1, ok: true }, { jev });
    // The amount came from the system: only the refund method is asked for.
    expect(r.action).toMatchObject({ type: "ask", slot: "method" });
    expect(r.view.slots.amount).toMatchObject({ value: "64", confidence: 1 });
  });

  test("each thing is read once per customer message, and gate decisions are recorded", async () => {
    const recorder = memoryRecorder();
    const jev = scripted({ intent: () => ["refund", 0.98], slot: () => ["none", 0.99] });
    const r1 = await turn(service, [], { type: "customer", text: "I'd like a refund" }, { jev, recorder });
    expect(r1.action).toMatchObject({ type: "ask", slot: "name" });
    // One request for the intent, one for the first step's values (name and account ID together).
    expect(jev.requests.length).toBe(2);
    // (No account ID candidates in the text, so code settles that one without asking.)
    expect(questionIds(jev.requests[1]!)).toEqual(["slot_name::value"]);
    expect(recorder.events.map((e) => [e.method, e.task, e.decision])).toEqual([
      ["service-agent.intent", "refund", "act"],
      ["service-agent.slot", "name", "skip"],
      ["service-agent.slot", "account_id", "skip"],
    ]);
  });
});

function questionIds(r: JevRequest): string[] {
  return Object.keys(r.questions);
}

describe("the store example", () => {
  test("a damaged item: looked up, refunded in full after a read-back, then goodbye", async () => {
    const { service: store, runTool } = await import("../examples/service-agent/store.ts");
    const jev = scripted({
      intent: (c) => (c.includes("torn") ? ["refund", 0.97] : ["none", 0.99]),
      slot: (slot, chat, options) => found({ order_id: /\d{10}/, email: /\S+@\S+\.com/ })(slot, chat, options),
      // The policy says a damaged item gets a full refund; the lookup's note is in the chat.
      policy: (options, chat) => (chat.includes("delivered 12 days ago") && chat.includes("torn") && options.includes("refund") ? ["refund", 0.95] : ["none", 0.97]),
      confirm: () => ["yes", 0.97],
      yesNo: (about, chat) => (about === "more" ? (chat.endsWith("that's all") ? 0.03 : 0.97) : 0.5),
    });
    let log: AgentEvent[] = [];
    const said: string[] = [];
    const made: string[] = [];
    for (const text of ["My boots arrived with a torn sole. Order 1234567890, ana@example.com", "yes please", "no, that's all"]) {
      let r = await turn(store, log, { type: "customer", text }, { jev });
      for (;;) {
        said.push(...r.messages);
        if (r.action.type !== "call") break;
        made.push(r.action.tool);
        r = await turn(store, r.log, { type: "result", tool: r.action.tool, step: r.action.step, ...runTool(r.action.tool, r.action.values) }, { jev });
      }
      log = r.log;
    }
    expect(made).toEqual(["look-up-order", "refund"]);
    expect(said[0]).toBe("Just to confirm, I'll refund the price to the original payment method (amount: 120.00). Shall I go ahead?");
    expect(view(log).ended?.how).toBe("done");
  });
});
