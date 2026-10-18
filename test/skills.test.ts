// The agent skill ships inside the package (packages/question-kit/skills, for node_modules) and is
// mirrored at the repo root (skills/, where `npx skills add Engid/question-kit` looks). The package
// copy is the one to edit; this keeps the mirror from drifting.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const canonical = join(here, "..", "packages", "question-kit", "skills");
const mirror = join(here, "..", "skills");

function files(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? files(join(dir, e.name), join(prefix, e.name)) : [join(prefix, e.name)]))
    .sort();
}

describe("the agent skill", () => {
  test("the root skills/ folder mirrors the package's, file for file", () => {
    const names = files(canonical);
    expect(names).toContain(join("question-kit", "SKILL.md"));
    expect(files(mirror)).toEqual(names);
    for (const name of names) expect(readFileSync(join(mirror, name), "utf8")).toBe(readFileSync(join(canonical, name), "utf8"));
  });

  test("SKILL.md has the frontmatter the Agent Skills format needs", () => {
    // Line endings normalized: a Windows checkout has \r\n where the repository has \n.
    const text = readFileSync(join(canonical, "question-kit", "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
    const front = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
    expect(front).toMatch(/^name: question-kit$/m);
    expect(front).toMatch(/^description: \S/m);
  });
});
