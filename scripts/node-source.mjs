// `node --import ./scripts/node-source.mjs app.ts`: run the repo's examples and scripts under Node
// on question-kit's TypeScript source, as Bun does through tsconfig.json's `paths`. Node strips the
// types itself (22.18 or later). Published users don't need this: they get the built package.

import { registerHooks } from "node:module";

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

