// The page's script: the agent and the register run here, in the browser. Jev is reached through
// the local server (server.ts), which adds the API key; the browser never sees it.

import { type AgentEvent, defaultTemplates, type Phrase, turn, type TurnResult } from "question-kit/service-agent";
import { type ChoiceAnswer, estimateCost, type Question, type SystemOneCall, type SystemOneClient } from "question-kit";
import { priceOf } from "../menu.ts";
import { Register } from "../register.ts";
import { shop, wording } from "../shop.ts";

const client: SystemOneClient = {
  async systemOne(request) {
    const res = await fetch("/systemone", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ state: request.state, questions: request.questions, ...(request.model ? { model: request.model } : {}) }) });
    if (!res.ok) throw new Error(`the server said ${res.status}: ${await res.text()}`);
    return res.json();
  },
};
const calls: SystemOneCall[] = [];
const opts = { client, calls, templates: { ...defaultTemplates, ...wording } };
const reg = new Register();
let log: AgentEvent[] = [];
let seen = 0;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const chat = $("chat");
const form = $<HTMLFormElement>("form");
const input = $<HTMLInputElement>("input");
const send = $<HTMLButtonElement>("send");

fetch("/mode").then((r) => r.json()).then((m: { mode: string }) => {
  if (m.mode !== "live") {
    const el = $("mode");
    el.textContent = m.mode === "fake" ? "A rule-of-thumb stand-in is answering, not Jev (--fake)." : "Cached answers only (--replay).";
    el.hidden = false;
  }
});

function line(kind: string, who: string, html: string): void {
  const el = document.createElement("div");
  el.className = `line ${kind}`;
  el.innerHTML = `<span class="who">${who}</span><span class="text">${html}</span>`;
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const n = (confidence: number, outcome: string) => `<span class="n">${confidence.toFixed(2)} ${outcome === "act" ? "✓" : outcome === "unsure" ? "?" : "–"}</span>`;

/** One line per thing Jev read. */
function explain(events: AgentEvent[]): void {
  const after: (() => void)[] = [];
  const phrase = (ph: Phrase) => {
    const what = ph.tool === null ? "nothing" : `${shop.tools[ph.tool]?.name?.toLowerCase() ?? ph.tool}${ph.record ? ` line ${ph.record}` : ""}`;
    return `“${esc(ph.text)}” → ${what}${ph.readBack ? ` (${esc(ph.readBack.join(", "))})` : ""}${n(ph.confidence, ph.outcome)}`;
  };
  for (const e of events) {
    if (e.type === "read-intent") line("jev", "Jev", `intent → ${e.value ?? "none"}${n(e.confidence, e.outcome)}`);
    else if (e.type === "read-aside" && e.value) line("jev", "Jev", `aside → ${e.value}${n(e.confidence, e.outcome)}`);
    else if (e.type === "read-repeat") for (const ph of e.phrases) line("jev", "Jev", phrase(ph));
    else if (e.type === "read-yes-no") {
      const what = e.about === "finished" ? "done ordering" : e.about === "right" ? "order right" : e.about === "more" ? "anything else" : e.about === "fixed" ? "fixed" : `is it ${esc(e.checked)}`;
      const show = () => line("jev", "Jev", `${what}? → ${e.value ? "yes" : "no"}${n(e.confidence, e.outcome)}`);
      if (e.about === "finished") after.push(show);
      else show();
    } else if (e.type === "read-review") {
      const worst = Math.max(e.missing, ...e.wrong.map((w) => w.p));
      line("jev", "Jev", `check → ${e.doubt ? "something looks wrong, reading it back" : "nothing looks wrong"}<span class="n">P(wrong) ${worst <= 0.005 ? "≤ 0.01" : worst.toFixed(2)}</span>`);
    } else if (e.type === "read-slot" && e.outcome === "skip" && e.confidence === 1) line("jev code", "code", `${esc(shop.slots[e.slot]?.label ?? e.slot)} → nothing that looks like one`);
    else if (e.type === "read-slot") line("jev", "Jev", `${esc(shop.slots[e.slot]?.label ?? e.slot)} → ${esc(e.value ?? "none")}${n(e.confidence, e.outcome)}`);
    else if (e.type === "read-confirm") line("jev", "Jev", `go ahead? → ${e.answer}${n(e.confidence, e.outcome)}`);
  }
  for (const f of after) f();
}

function board(): void {
  $("board-title").innerHTML = reg.orderNumber ? `Order <b>#${reg.orderNumber}</b>` : "Your order";
  if (!reg.lines.length) {
    $("board").innerHTML = `<p class="empty">Nothing yet.</p>`;
    return;
  }
  const rows = reg.lines.map((l, k) => `<tr><td class="n">${k + 1}</td><td>${esc(reg.readBack([l.item])[0]!)}</td><td class="price">$${priceOf(l.item).toFixed(2)}</td></tr>`);
  $("board").innerHTML = `<table>${rows.join("")}<tr class="total"><td></td><td>Total</td><td class="price">$${reg.total().toFixed(2)}</td></tr></table>`;
}

/** The requests made since the last time, each with its questions and top answers. */
function requests(): void {
  const text = (q: Question) => (typeof q.instructions === "string" ? q.instructions : JSON.stringify(q.instructions)).replace(/\s+/g, " ");
  for (const c of calls.slice(seen)) {
    const d = document.createElement("details");
    const qs = Object.entries(c.request.questions);
    const tokens = c.response.usage?.input_tokens;
    d.innerHTML = `<summary>${esc(c.title || "request")} <span class="n">· ${qs.length} question${qs.length === 1 ? "" : "s"}${tokens ? ` · ${tokens.toLocaleString()} tokens` : ""} · ${c.ms.toFixed(0)} ms</span></summary>`;
    for (const [id, q] of qs) {
      const a = c.response.answers[id];
      let bars = "";
      if (a && "noul" in a) bars = `<div class="bar"><span>yes</span><span>${a.noul.toFixed(2)}</span><i class="ok" style="width:${(a.noul * 100).toFixed(0)}%"></i></div>`;
      else if (a) {
        const ranked = Object.entries((a as ChoiceAnswer).probabilities).sort((x, y) => y[1] - x[1]).slice(0, 3).filter(([, v], i) => i === 0 || v >= 0.01);
        bars = ranked.map(([k, v]) => `<div class="bar"><span title="${esc(k)}">${esc(k)}</span><span>${v.toFixed(2)}</span><i style="width:${(v * 100).toFixed(0)}%"></i></div>`).join("");
      }
      d.insertAdjacentHTML("beforeend", `<div class="q"><span class="id">${esc(id)}</span> ${esc(text(q))}</div>${bars}`);
    }
    $("requests").prepend(d);
  }
  seen = calls.length;
  $("cost").textContent = calls.length ? `${calls.length} so far, about $${estimateCost(calls).toFixed(4)}.` : "None yet.";
}

async function say(text: string): Promise<void> {
  line("you", "You", esc(text));
  reg.newMessage();
  const said: string[] = [];
  const show = (r: TurnResult) => {
    explain(r.log.slice(log.length));
    log = r.log;
    said.push(...r.messages);
    requests();
  };
  let r = await turn(shop, log, { type: "customer", text }, opts);
  show(r);
  while (r.action.type === "call") {
    const { did, ...result } = reg.run(r.action.tool, r.action.values);
    line("register", "Register", `${esc(r.action.tool)}: ${esc(did)}`);
    if (r.action.tool === "show-menu") line("menu", "Menu", (result.data as string[]).map(esc).join("<br>"));
    board();
    r = await turn(shop, r.log, { type: "result", tool: r.action.tool, step: r.action.step, ...result }, opts);
    show(r);
  }
  line("agent", "Agent", esc(said.join(" ")));
  board();
  if (r.view.ended) {
    line("note", "", r.view.ended.how === "done" ? "The order's in. Reload the page to start another." : `Handed off to a person: ${esc(r.view.ended.reason ?? "")}. Reload to start again.`);
    input.disabled = true;
    send.disabled = true;
  }
}

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  input.disabled = true;
  send.disabled = true;
  try {
    await say(text);
  } catch (err) {
    line("note", "", `Something went wrong: ${esc(err instanceof Error ? err.message : String(err))}`);
  } finally {
    if (!log.some((e) => e.type === "end")) {
      input.disabled = false;
      send.disabled = false;
      input.focus();
    }
  }
});
input.focus();
