// Downloads UD English EWT (pinned release) into data/ud/ and checks each file's SHA-256.
// The treebank is CC BY-SA 4.0 (annotations © Stanford University) over source texts with their
// own copyright holders, so this repo downloads it instead of redistributing it.
//   bun run fetch-ud            # dev + test
//   bun run fetch-ud --train    # also train (15 MB; not needed by the evals)

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { EWT, type Split, UD_DIR } from "./data.ts";

const splits: Split[] = process.argv.includes("--train") ? ["dev", "test", "train"] : ["dev", "test"];
await mkdir(UD_DIR, { recursive: true });

for (const split of splits) {
  const { name, sha256 } = EWT.files[split];
  const path = join(UD_DIR, name);
  const existing = Bun.file(path);
  if (await existing.exists()) {
    const hash = new Bun.CryptoHasher("sha256").update(await existing.arrayBuffer()).digest("hex");
    if (hash === sha256) {
      console.log(`✓ ${name} (already present)`);
      continue;
    }
  }
  const url = `${EWT.base}/${name}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  const buf = await res.arrayBuffer();
  const hash = new Bun.CryptoHasher("sha256").update(buf).digest("hex");
  if (hash !== sha256) throw new Error(`${name}: SHA-256 mismatch (got ${hash}, expected ${sha256})`);
  await Bun.write(path, buf);
  console.log(`✓ ${name} (${EWT.release}, ${(buf.byteLength / 1e6).toFixed(1)} MB)`);
}
console.log("UD English EWT is CC BY-SA 4.0: https://github.com/UniversalDependencies/UD_English-EWT");
