// bun run pizza:web — serve the pizza counter page and forward its requests to Jev.
//
//   bun run pizza:web               http://localhost:8787, with TYPESAFE_API_KEY from .env
//   bun run pizza:web --replay      cached answers only
//   bun run pizza:web --fake        the rule-of-thumb stand-in instead of Jev (no key needed)
//
// The page's script (app.ts) is bundled for the browser when the server starts. The key stays
// here: the page posts System One requests to /systemone and this server makes the real call.
//
// On Node (22.18 or later): npm run pizza:web:node, with the same options after --.

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import type { SystemOneRequest } from "question-kit";
import { CacheMissError, cachedJev } from "question-kit/cache";
import { typesafeJev } from "question-kit/typesafe";
import { fakeShopClient } from "../fake.ts";

const { values: args } = parseArgs({ options: { replay: { type: "boolean", default: false }, fake: { type: "boolean", default: false }, port: { type: "string", default: "8787" } } });
const cacheDir = join(import.meta.dirname, "..", "..", "..", ".cache", "jev");
const client = args.fake ? fakeShopClient() : args.replay ? cachedJev(undefined, cacheDir, { mode: "replay" }) : cachedJev(typesafeJev(), cacheDir);
const mode = args.fake ? "fake" : args.replay ? "replay" : "live";

// The page's script, bundled for the browser once at start (esbuild follows tsconfig.json's paths
// to question-kit's source, as Bun does).
const built = await build({ entryPoints: [join(import.meta.dirname, "app.ts")], bundle: true, format: "esm", platform: "browser", write: false, logLevel: "error" });
const appJs = built.outputFiles[0]!.text;
const html = await readFile(join(import.meta.dirname, "index.html"), "utf8");

async function respond(method: string, pathname: string, body: string): Promise<{ status: number; type: string; body: string }> {
  if (pathname === "/") return { status: 200, type: "text/html; charset=utf-8", body: html };
  if (pathname === "/app.js") return { status: 200, type: "text/javascript; charset=utf-8", body: appJs };
  if (pathname === "/mode") return { status: 200, type: "application/json", body: JSON.stringify({ mode }) };
  if (pathname === "/systemone" && method === "POST") {
    const request = JSON.parse(body) as SystemOneRequest;
    try {
      const answer = await client.systemOne({ state: request.state, questions: request.questions, ...(request.model ? { model: request.model } : {}) });
      return { status: 200, type: "application/json", body: JSON.stringify(answer) };
    } catch (err) {
      if (err instanceof CacheMissError) return { status: 503, type: "text/plain", body: "that answer isn't cached; run without --replay to ask Jev" };
      console.error(err);
      return { status: 502, type: "text/plain", body: err instanceof Error ? err.message : String(err) };
    }
  }
  return { status: 404, type: "text/plain", body: "not found" };
}

const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const r = await respond(req.method ?? "GET", new URL(req.url ?? "/", "http://localhost").pathname, body);
  res.writeHead(r.status, { "content-type": r.type });
  res.end(r.body);
});
server.listen(Number(args.port), () => console.log(`Pizza counter at http://localhost:${args.port}${mode === "live" ? "" : ` (${mode})`}`));
