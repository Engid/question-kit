// `node --import ./scripts/node-source.mjs app.ts`: run the repo's examples and scripts under Node
// on question-kit's TypeScript source, as Bun does through tsconfig.json's `paths`. Node strips the
// types itself (22.18 or later). Published users don't need this: they get the built package.

import * as nodeModule from "node:module";

// Older Nodes have no registerHooks (and don't strip types), so stop with a clear message instead
// of a link error. Type stripping is on by default from 22.18 (and 23.6).
const [major, minor] = process.versions.node.split(".").map(Number);
const supported = major >= 24 || (major === 23 && minor >= 6) || (major === 22 && minor >= 18);
if (!supported || typeof nodeModule.registerHooks !== "function") {
  console.error(
    `question-kit's examples and scripts need Node 22.18 or later; this is Node ${process.versions.node} (${process.execPath}).`,
  );
  process.exit(1);
}
const { registerHooks } = nodeModule;

const pkg = new URL("../packages/question-kit/", import.meta.url);

/** The source file for a question-kit import, like the `paths` in tsconfig.json. */
function source(specifier) {
  if (specifier === "question-kit") return new URL("core/index.ts", pkg);
  if (!specifier.startsWith("question-kit/")) return undefined;
  const sub = specifier.slice("question-kit/".length);
  if (sub.startsWith("experimental/")) return new URL(`${sub}.ts`, pkg);
  if (sub === "order" || sub === "service-agent") return new URL(`${sub}/index.ts`, pkg);
  return new URL(`core/${sub}.ts`, pkg);
}

registerHooks({
  resolve(specifier, context, next) {
    const url = source(specifier);
    return url ? { url: url.href, shortCircuit: true } : next(specifier, context);
  },
});

