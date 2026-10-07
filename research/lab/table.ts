export function pct(x: number): string {
  return `${(100 * x).toFixed(1)}%`;
}

/**
 * A plain-text table as lines: a header, a ─ rule under each column, then the rows. Numbers are
 * right-aligned; everything else is left-aligned. Widths count display columns, so bars and wide
 * characters line up.
 */
export function formatTable(header: string[], rows: (string | number)[][], indent = 2): string[] {
  const cells = [header, ...rows.map((r) => r.map(String))];
  const width = (s: string) => Bun.stringWidth(s);
  const widths = header.map((_, c) => Math.max(...cells.map((r) => width(r[c] ?? ""))));
  const pad = (s: string, w: number, left: boolean) => (left ? " ".repeat(Math.max(0, w - width(s))) + s : s + " ".repeat(Math.max(0, w - width(s))));
  const isNum = (s: string) => s === "—" || (/\d/.test(s) && /^[-\d.,%/ —≈]+$/.test(s));
  const margin = " ".repeat(indent);
  const line = (r: string[]) => (margin + r.map((s, c) => pad(s, widths[c] ?? 0, c > 0 && isNum(s))).join("  ")).trimEnd();
  return [line(header), margin + widths.map((w) => "─".repeat(w)).join("  "), ...cells.slice(1).map(line)];
}

/** Print a plain-text table (see formatTable). */
export function printTable(header: string[], rows: (string | number)[][], indent = 2): void {
  for (const l of formatTable(header, rows, indent)) console.log(l);
}
