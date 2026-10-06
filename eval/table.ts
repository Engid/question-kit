export function pct(x: number): string {
  return `${(100 * x).toFixed(1)}%`;
}

/** Print a plain-text table with right-aligned numbers. */
export function printTable(header: string[], rows: (string | number)[][]): void {
  const cells = [header, ...rows.map((r) => r.map(String))];
  const widths = header.map((_, c) => Math.max(...cells.map((r) => (r[c] ?? "").length)));
  const isNum = (s: string) => s === "—" || (/\d/.test(s) && /^[-\d.,%/ —≈]+$/.test(s));
  const line = (r: string[]) =>
    "  " + r.map((s, c) => (c > 0 && isNum(s) ? s.padStart(widths[c] ?? 0) : s.padEnd(widths[c] ?? 0))).join("  ");
  console.log(line(header));
  console.log("  " + widths.map((w) => "─".repeat(w)).join("  "));
  for (const r of cells.slice(1)) console.log(line(r));
}
