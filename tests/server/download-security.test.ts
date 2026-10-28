import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { downloadMedia, type DownloadGuards } from "@/lib/sources/download";

test("download deadline covers DNS, headers and active streams; rejected bodies close", { timeout: 10_000 }, async () => {
  const closed = new Set<string>();
  const server = http.createServer((request, response) => {
    response.on("close", () => closed.add(request.url!));
    if (request.url === "/headers") return;
    response.writeHead(200, { "Content-Type": request.url === "/page" ? "text/html" : "video/mp4" });
    response.write(Buffer.alloc(100));
    const timer = setInterval(() => response.write(Buffer.alloc(100)), 10);
    response.on("close", () => clearInterval(timer));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const guards: DownloadGuards = { parse: (raw) => new URL(raw), assertHost: async () => {}, lookup: (() => {}) as never };
  const directory = await mkdtemp(path.join(tmpdir(), "zenith-deadline-"));
  try {
    const target = path.join(directory, "partial");
    for (const endpoint of ["/dns", "/headers", "/stream"]) {
      await assert.rejects(downloadMedia(`${base}${endpoint}`, target, { maxBytes: 100_000, timeoutMs: 200 }, endpoint === "/dns" ? { ...guards, assertHost: () => new Promise(() => {}) } : guards), /took too long/);
      await assert.rejects(stat(target), { code: "ENOENT" });
    }
    await assert.rejects(downloadMedia(`${base}/page`, target, { maxBytes: 100_000, timeoutMs: 2000 }, guards), /web page/);
    for (let attempt = 0; attempt < 50 && closed.size < 3; attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
    for (const endpoint of ["/headers", "/stream", "/page"]) assert.ok(closed.has(endpoint), `${endpoint} connection closed`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
