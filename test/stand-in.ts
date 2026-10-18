// A local stand-in server for tests, on node:http so the same tests run under Bun and Node.
// The handler takes a web Request and returns a Response, like Bun.serve's.

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export interface StandIn {
  /** The server's root, with a trailing slash (http://127.0.0.1:<port>/). */
  url: URL;
  stop(): Promise<void>;
}

export async function standIn(handle: (req: Request) => Response | Promise<Response>): Promise<StandIn> {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body: hasBody ? Buffer.concat(chunks) : undefined });
    const response = await handle(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: new URL(`http://127.0.0.1:${port}/`),
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
