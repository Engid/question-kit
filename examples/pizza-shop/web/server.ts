// bun run pizza:web — serve the pizza counter page and forward its requests to Jev.
//
//   bun run pizza:web               http://localhost:8787, with TYPESAFE_API_KEY from .env
//   bun run pizza:web --replay      cached answers only
//   bun run pizza:web --fake        the rule-of-thumb stand-in instead of Jev (no key needed)
//
// The page's script (app.ts) is bundled for the browser when the server starts. The key stays
// here: the page posts System One requests to /systemone and this server makes the real call.

import { join } from "node:path";
import { parseArgs } from "node:util";
import type { SystemOneRequest } from "question-kit";
import { CacheMissError, cachedJev } from "question-kit/cache";
import { typesafeJev } from "question-kit/typesafe";
import { fakeShopClient } from "../fake.ts";

const { values: args } = parseArgs({ options: { replay: { type: "boolean", default: false }, fake: { type: "boolean", default: false }, port: { type: "string", default: "8787" } } });
const cacheDir = join(import.meta.dir, "..", "..", "..", ".cache", "jev");
const client = args.fake ? fakeShopClient() : args.replay ? cachedJev(undefined, cacheDir, { mode: "replay" }) : cachedJev(typesafeJev(), cacheDir);
const mode = args.fake ? "fake" : args.replay ? "replay" : "live";

const built = await Bun.build({ entrypoints: [join(import.meta.dir, "app.ts")], target: "browser", minify: false });
if (!built.success) {
  for (const m of built.logs) console.error(m);
  process.exit(1);
}
const appJs = await built.outputs[0]!.text();
const html = await Bun.file(join(import.meta.dir, "index.html")).text();

const server = Bun.serve({
  port: Number(args.port),
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/") return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    if (pathname === "/app.js") return new Response(appJs, { headers: { "content-type": "text/javascript; charset=utf-8" } });
    if (pathname === "/mode") return Response.json({ mode });
    if (pathname === "/systemone" && req.method === "POST") {
      const body = (await req.json()) as SystemOneRequest;
      try {
        return Response.json(await client.systemOne({ state: body.state, questions: body.questions, ...(body.model ? { model: body.model } : {}) }));
      } catch (err) {
        if (err instanceof CacheMissError) return new Response("that answer isn't cached; run without --replay to ask Jev", { status: 503 });
        console.error(err);
        return new Response(err instanceof Error ? err.message : String(err), { status: 502 });
      }
    }
    return new Response("not found", { status: 404 });
  },
});
console.log(`Pizza counter at http://localhost:${server.port}${mode === "live" ? "" : ` (${mode})`}`);
