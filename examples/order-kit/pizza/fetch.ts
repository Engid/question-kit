// bun run fetch-pizza — downloads the PIZZA benchmark's menu catalogs into data/pizza/, pinned to
// one commit and checked by SHA-256. The dataset is CC BY-NC 4.0 (non-commercial), so this repo
// downloads it instead of including it.

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PIZZA, PIZZA_DIR } from "./catalog.ts";

for (const [file, sha256] of Object.entries(PIZZA.files)) {
  const path = join(PIZZA_DIR, file);
  const existing = Bun.file(path);
  if (await existing.exists()) {
    const hash = new Bun.CryptoHasher("sha256").update(await existing.arrayBuffer()).digest("hex");
    if (hash === sha256) {
      console.log(`✓ ${file} (already present)`);
      continue;
    }
  }
  const url = `https://raw.githubusercontent.com/${PIZZA.repo}/${PIZZA.commit}/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  const buf = await res.arrayBuffer();
  const hash = new Bun.CryptoHasher("sha256").update(buf).digest("hex");
  if (hash !== sha256) throw new Error(`${file}: SHA-256 mismatch (got ${hash}, expected ${sha256})`);
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, buf);
  console.log(`✓ ${file} (${(buf.byteLength / 1e3).toFixed(0)} kB)`);
}
console.log(`PIZZA is ${PIZZA.license}: https://github.com/${PIZZA.repo}`);
