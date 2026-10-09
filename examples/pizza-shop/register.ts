// A made-up register: the order's lines and prices. The agent never touches the order; it calls
// these tools, and the register reports back the lines (for "change line 2") and what to say.

import { type OrderItem, readBackLines } from "question-kit/order";
import type { Record_ } from "question-kit/service-agent";
import type { Json } from "question-kit";
import { menuLines, pizzaMenu, priceOf } from "./menu.ts";

export interface Line {
  id: string;
  item: OrderItem;
}

export interface ToolResult {
  ok: boolean;
  /** What the register did, for the screen. */
  did: string;
  records?: Record<string, Record_[]>;
  say?: string;
  note?: string;
  data?: Json;
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** +14795550100 → (479) 555-0100, for what the agent says. */
export function formatPhone(raw: unknown): string {
  const m = String(raw).match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : String(raw);
}

export class Register {
  lines: Line[] = [];
  orderNumber: number | null = null;
  private next = 1;
  private addsThisMessage = 0;

  /** The customer sent a message: the next add is read back as "Got it: …", later ones as "And …". */
  newMessage(): void {
    this.addsThisMessage = 0;
  }

  readBack(items: OrderItem[]): string[] {
    return readBackLines(items, pizzaMenu());
  }

  /** The lines as the agent's `from: "order"` slot sees them. */
  records(): Record<string, Record_[]> {
    return { order: this.lines.map((l) => ({ id: l.id, text: this.readBack([l.item])[0]! })) };
  }

  /** "So that's A and B.": the whole order, said after a change so the customer can catch a mistake. */
  soThats(): string {
    return this.lines.length ? ` So that's ${list(this.lines.map((l) => this.readBack([l.item])[0]!))}.` : " That leaves nothing on the order.";
  }

  total(): number {
    return Math.round(this.lines.reduce((s, l) => s + priceOf(l.item), 0) * 100) / 100;
  }

  run(tool: string, values: Record<string, Json>): ToolResult {
    const items = (values.items ?? []) as unknown as OrderItem[];
    const line = this.lines.find((l) => l.id === values.line);
    switch (tool) {
      case "add-items": {
        for (const it of items) this.lines.push({ id: String(this.next++), item: structuredClone(it) });
        const back = this.readBack(items);
        const say = this.addsThisMessage++ === 0 ? `Got it: ${list(back)}.` : `And ${list(back)}.`;
        return { ok: true, did: `added ${list(back)}`, records: this.records(), say };
      }
      case "change-item": {
        if (!line) return { ok: false, did: "no such line", say: "Sorry, I lost track of which one that was: what should it be?" };
        const change = items[0];
        if (!change) return { ok: false, did: "nothing to change" };
        const details = Object.keys(change.values).length > 0 || Object.values(change.lists).some((cs) => cs.length);
        // "Make one of them a medium": a smaller number with details splits the line.
        if (change.numberSaid && details && change.number < line.item.number) {
          const rest: OrderItem = structuredClone(line.item);
          rest.number -= change.number;
          line.item.number = change.number;
          this.lines.splice(this.lines.indexOf(line) + 1, 0, { id: String(this.next++), item: rest });
        }
        const it = line.item;
        // The customer's words say what changes: a size or drink replaces, a topping is added (or
        // marked "no", which the kitchen needs to see), a number that was said sets how many. The
        // rest stays.
        for (const [f, v] of Object.entries(change.values)) if (f !== "drink" || it.kind === "drink") it.values[f] = v;
        for (const [f, cs] of Object.entries(change.lists)) {
          const kept = (it.lists[f] ?? []).filter((c) => !cs.some((d) => d.id === c.id));
          it.lists[f] = [...kept, ...cs];
        }
        if (change.numberSaid && !(details && change.number < it.number)) it.number = change.number;
        const back = this.readBack([it])[0]!;
        return { ok: true, did: `changed line ${line.id} to ${back}`, records: this.records(), say: `Changed that to ${back}.${this.lines.length > 1 ? this.soThats() : ""}` };
      }
      case "remove-item": {
        if (!line) return { ok: false, did: "no such line", say: "Sorry, which one should I take off?" };
        this.lines.splice(this.lines.indexOf(line), 1);
        const back = this.readBack([line.item])[0]!;
        return { ok: true, did: `removed ${back}`, records: this.records(), say: `Took off the ${back.replace(/^\d+ /, "")}.${this.soThats()}` };
      }
      case "show-menu":
        return { ok: true, did: "showed the menu", data: menuLines(), say: "Here's what we've got." };
      case "place-order": {
        if (!this.lines.length) return { ok: false, did: "nothing on the order", note: "The order is empty." };
        this.orderNumber = 100 + Math.floor(Math.random() * 900);
        const phone = formatPhone(values.phone);
        return { ok: true, did: `order #${this.orderNumber} sent to the kitchen, $${this.total().toFixed(2)}`, note: `Order #${this.orderNumber} placed; the customer will be texted at ${phone}.`, say: `You're order #${this.orderNumber}, $${this.total().toFixed(2)}. We'll text ${phone} when it's ready.` };
      }
    }
    return { ok: false, did: `unknown tool ${tool}` };
  }
}
