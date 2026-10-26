import http from "node:http";
process.env.NODE_ENV = "production";
const { default: next } = await import("next");

const port = Number(process.env.PORT || 3000);
process.env.NEXT_DIST_DIR ||= ".next-production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const app = next({ dev: false, hostname, port });
await app.prepare();
const handler = app.getRequestHandler();
const server = http.createServer((request, response) => { void handler(request, response).catch(() => { if (!response.headersSent) response.writeHead(500); response.end("Request failed"); }); });
server.requestTimeout = 240_000;
server.headersTimeout = 30_000;
server.listen(port, hostname, () => console.info(`Studio listening on port ${port}`));
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  if (globalThis.reelQueue) globalThis.reelQueue.draining = true;
  console.info("Draining studio; unfinished queued jobs will require retry after restart.");
  server.close(); server.closeIdleConnections();
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline && (globalThis.reelQueue?.running || globalThis.uploadsInFlight)) await new Promise((resolve) => setTimeout(resolve, 250));
  for (const child of globalThis.studioChildProcesses || []) child.kill("SIGKILL");
  await app.close(); server.closeAllConnections(); process.exit(0);
}
process.once("SIGTERM", () => void stop()); process.once("SIGINT", () => void stop());
