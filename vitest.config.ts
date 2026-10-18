// `bun run test:node`: the same tests as `bun test`, under Node, with vitest. The tests import
// "bun:test", which vitest answers; "question-kit" resolves to the source, as in tsconfig.json.

import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const pkg = resolve(import.meta.dirname, "packages/question-kit");

export default defineConfig({
  resolve: {
    alias: [
      { find: "bun:test", replacement: "vitest" },
      { find: /^question-kit\/experimental\/(.*)$/, replacement: `${pkg}/experimental/$1.ts` },
      { find: /^question-kit\/(order|service-agent)$/, replacement: `${pkg}/$1/index.ts` },
      { find: /^question-kit\/(.*)$/, replacement: `${pkg}/core/$1.ts` },
      { find: /^question-kit$/, replacement: `${pkg}/core/index.ts` },
    ],
  },
  test: { include: ["test/*.test.ts"] },
});
