// Canary for the Bun workaround in core/typesafe.ts: TypeSafe's SDK on its own, under Bun, against
// a local stand-in. While the SDK fails there ("Body already used"), the workaround is needed. When
// this test fails, the SDK or Bun has been fixed: delete the workaround and this test.

import { afterAll, expect, test } from "bun:test";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { standIn } from "./stand-in.ts";

const isBun = typeof process !== "undefined" && Boolean(process.versions?.bun);

const server = await standIn(async (req) => {
  const body = (await req.json()) as { model: string };
  return Response.json({ model: body.model, answers: { q: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 10 } });
});
afterAll(() => server.stop());

test.skipIf(!isBun)("the SDK alone still fails under Bun (so the workaround is still needed)", async () => {
  const client = new TypeSafeClient({ apiKey: "test", baseURL: server.url.href, retry: { maxRetries: 0 }, logLevel: "off" });
  let error: unknown;
  try {
    await client.systemOne({ state: "hello", questions: { q: { type: "noul", instructions: "Is this a greeting?" } } } as never);
  } catch (err) {
    error = err;
  }
  if (!error) throw new Error("TypeSafe's SDK now works under Bun: remove bunFetch from core/typesafe.ts and this test");
  expect(String(error)).toMatch(/Body already used/);
});
