import "../../scripts/isolated-data";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { assertPublicHost, isPrivateAddress, parseMediaUrl, UnsafeUrlError } from "@/lib/sources/url-safety";
import { downloadMedia, type DownloadGuards } from "@/lib/sources/download";
import { issueSession, sessionCookie } from "@/lib/server/security";
import { createSessionId, ensureSession } from "@/lib/storage/session-storage";
import { ffmpeg, runProcess } from "@/lib/video/process";
import { PUT } from "@/app/api/sources/upload/route";
import { GET as LIST, POST as IMPORT } from "@/app/api/sources/route";
import { GET as READ, DELETE as REMOVE } from "@/app/api/sources/[id]/route";

test("private, loopback, link-local, metadata and mapped addresses are blocked; public ones pass", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd12::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a9fe:a9fe", "not-an-ip"]) assert.equal(isPrivateAddress(address), true, address);
  for (const address of ["8.8.8.8", "151.101.1.69", "2606:4700:4700::1111"]) assert.equal(isPrivateAddress(address), false, address);
});

test("media links must be plain public http(s) on standard ports, without credentials or platform pages", () => {
  for (const url of ["ftp://example.com/a.mp4", "file:///C:/Windows/win.ini", "https://user:pass@example.com/a.mp4", "https://example.com:8080/a.mp4", "http://localhost/a.mp4", "http://printer.local/a.mp4", "http://10.0.0.5/a.mp4", "http://[::1]/a.mp4", "http://169.254.169.254/latest/meta-data", "https://www.youtube.com/watch?v=abc", "https://youtu.be/abc", "https://open.spotify.com/episode/1", "intranet/a.mp4", "not a url"]) assert.throws(() => parseMediaUrl(url), UnsafeUrlError, url);
  assert.equal(parseMediaUrl("https://cdn.example.org/show/episode-12.mp4").hostname, "cdn.example.org");
  assert.match((() => { try { parseMediaUrl("https://www.youtube.com/watch?v=x"); return ""; } catch (error) { return (error as Error).message; } })(), /creator tools/);
});

test("hosts resolving to any private address are rejected (DNS rebinding first line)", async () => {
  const resolve = (async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.7", family: 4 }]) as never;
  await assert.rejects(assertPublicHost(new URL("https://media.example.com/a.mp4"), resolve), /private network/);
  await assert.doesNotReject(assertPublicHost(new URL("https://media.example.com/a.mp4"), (async () => [{ address: "93.184.216.34", family: 4 }]) as never));
});

async function fixtureServer() {
  const server = http.createServer((request, response) => {
    if (request.url === "/clip.mp4") { response.writeHead(200, { "Content-Type": "video/mp4" }); return response.end(Buffer.alloc(4096, 1)); }
    if (request.url === "/huge.mp4") { response.writeHead(200, { "Content-Type": "video/mp4" }); let sent = 0; const timer = setInterval(() => { if (sent > 3 * 1048576 || response.destroyed) { clearInterval(timer); response.end(); return; } response.write(Buffer.alloc(65536)); sent += 65536; }, 1); return; }
    if (request.url === "/page") { response.writeHead(200, { "Content-Type": "text/html" }); return response.end("<html>"); }
    if (request.url?.startsWith("/loop")) { response.writeHead(302, { Location: `/loop${Number(request.url.slice(5) || 0) + 1}` }); return response.end(); }
    if (request.url === "/to-private") { response.writeHead(302, { Location: "http://evil.test/clip.mp4" }); return response.end(); }
    response.writeHead(404); response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const checked: string[] = [];
  // Tests reach a loopback fixture only by substituting the guards; production code always uses the safe defaults.
  const guards: DownloadGuards = {
    parse: (raw) => new URL(raw),
    assertHost: async (url) => { checked.push(url.hostname); if (url.hostname === "evil.test") throw new UnsafeUrlError("This link points to a local or private network address."); },
    lookup: ((hostname: string, options: { all?: boolean }, callback: (error: null, address: unknown, family?: number) => void) => (options?.all ? callback(null, [{ address: "127.0.0.1", family: 4 }]) : callback(null, "127.0.0.1", 4))) as never,
  };
  return { base: `http://media.test:${port}`, guards, checked, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

test("downloads stream with size limits, media-type checks and re-validated redirects", async () => {
  const fixture = await fixtureServer();
  const directory = path.join(tmpdir(), `zenith-download-${Date.now()}`); await mkdir(directory, { recursive: true });
  try {
    const target = path.join(directory, "a.part");
    const ok = await downloadMedia(`${fixture.base}/clip.mp4`, target, { maxBytes: 1048576, timeoutMs: 5000 }, fixture.guards);
    assert.equal(ok.bytes, 4096); assert.equal((await stat(target)).size, 4096);
    await assert.rejects(downloadMedia(`${fixture.base}/huge.mp4`, path.join(directory, "b.part"), { maxBytes: 1048576, timeoutMs: 5000 }, fixture.guards), /larger than/);
    await assert.rejects(stat(path.join(directory, "b.part")));
    await assert.rejects(downloadMedia(`${fixture.base}/page`, path.join(directory, "c.part"), { maxBytes: 1048576, timeoutMs: 5000 }, fixture.guards), /web page/);
    await assert.rejects(downloadMedia(`${fixture.base}/loop0`, path.join(directory, "d.part"), { maxBytes: 1048576, timeoutMs: 5000 }, fixture.guards), /redirected too many/);
    await assert.rejects(downloadMedia(`${fixture.base}/to-private`, path.join(directory, "e.part"), { maxBytes: 1048576, timeoutMs: 5000 }, fixture.guards), /private network/);
    assert.ok(fixture.checked.includes("evil.test"), "redirect target was re-validated");
    // With the real guards, a loopback fixture is refused before any request is made.
    await assert.rejects(downloadMedia("http://127.0.0.1/clip.mp4", path.join(directory, "f.part"), { maxBytes: 1048576, timeoutMs: 5000 }), /private network/);
  } finally { await fixture.close(); await rm(directory, { recursive: true, force: true }); }
});

async function streamUpload(sessionId: string, cookie: string, file: Buffer, type = "video/mp4", rights = "confirmed", origin?: string) {
  const headers: Record<string, string> = { Cookie: cookie, "Content-Type": type, "Content-Length": String(file.length) };
  if (origin) headers.Origin = origin;
  return PUT(new Request(`http://localhost/api/sources/upload?sessionId=${sessionId}&name=My%20Episode.mp4&rights=${rights}`, { method: "PUT", headers, body: new Uint8Array(file), duplex: "half" } as RequestInit));
}

test("streamed uploads are decode-validated, session-isolated and removable", { timeout: 120_000 }, async () => {
  const id = createSessionId(); const { token } = await issueSession(id); const directory = await ensureSession(id);
  const cookie = `${sessionCookie(id)}=${token}`;
  const fixture = path.join(directory, "episode-fixture.mp4");
  await runProcess(ffmpeg(), ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=6", "-f", "lavfi", "-i", "sine=frequency=300:d=6", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", fixture], "Source fixture");
  const bytes = await readFile(fixture);

  assert.equal((await streamUpload(id, cookie, bytes, "video/mp4", "no")).status, 400);
  assert.equal((await streamUpload(id, cookie, bytes, "text/html")).status, 415);
  assert.equal((await streamUpload(id, cookie, bytes, "video/mp4", "confirmed", "https://attacker.example")).status, 403);
  const invalid = await streamUpload(id, cookie, Buffer.from("not really a video at all, just text pretending"));
  assert.equal(invalid.status, 400); assert.equal((await invalid.json()).source.status, "failed");

  const response = await streamUpload(id, cookie, bytes);
  assert.equal(response.status, 200);
  const { source } = await response.json();
  assert.equal(source.status, "ready"); assert.equal(source.media.hasVideo, true); assert.equal(source.media.hasAudio, true);
  assert.ok(Math.abs(source.media.duration - 6) < 0.2); assert.equal(source.media.width, 640); assert.equal(source.label, "My Episode.mp4");

  const listed = await (await LIST(new Request(`http://localhost/api/sources?sessionId=${id}`, { headers: { Cookie: cookie } }))).json();
  assert.equal(listed.sources.filter((item: { status: string }) => item.status === "ready").length, 1);

  const other = createSessionId(); const otherAccess = await issueSession(other); await ensureSession(other);
  const otherCookie = `${sessionCookie(other)}=${otherAccess.token}`;
  assert.equal((await READ(new Request(`http://localhost/api/sources/${source.id}?sessionId=${id}`, { headers: { Cookie: otherCookie } }), { params: Promise.resolve({ id: source.id }) })).status, 401);
  assert.equal((await READ(new Request(`http://localhost/api/sources/${source.id}?sessionId=${other}`, { headers: { Cookie: otherCookie } }), { params: Promise.resolve({ id: source.id }) })).status, 404);
  assert.equal((await READ(new Request(`http://localhost/api/sources/../../x?sessionId=${id}`, { headers: { Cookie: cookie } }), { params: Promise.resolve({ id: "../../x" }) })).status, 404);

  assert.equal((await IMPORT(new Request("http://localhost/api/sources", { method: "POST", headers: { Cookie: cookie }, body: JSON.stringify({ sessionId: id, url: "http://169.254.169.254/latest", rightsConfirmed: true }) }))).status, 400);
  assert.equal((await IMPORT(new Request("http://localhost/api/sources", { method: "POST", headers: { Cookie: cookie }, body: JSON.stringify({ sessionId: id, url: "https://cdn.example.org/a.mp4" }) }))).status, 400);

  assert.equal((await REMOVE(new Request(`http://localhost/api/sources/${source.id}?sessionId=${id}`, { method: "DELETE", headers: { Cookie: cookie } }), { params: Promise.resolve({ id: source.id }) })).status, 200);
  assert.equal((await READ(new Request(`http://localhost/api/sources/${source.id}?sessionId=${id}`, { headers: { Cookie: cookie } }), { params: Promise.resolve({ id: source.id }) })).status, 404);
});

test("uploads larger than the configured limit are refused and leave nothing behind", async () => {
  const previous = process.env.MAX_SOURCE_MB; process.env.MAX_SOURCE_MB = "1";
  try {
    const id = createSessionId(); const { token } = await issueSession(id); await ensureSession(id);
    const cookie = `${sessionCookie(id)}=${token}`;
    const big = Buffer.alloc(2 * 1048576, 7);
    const response = await PUT(new Request(`http://localhost/api/sources/upload?sessionId=${id}&rights=confirmed`, { method: "PUT", headers: { Cookie: cookie, "Content-Type": "video/mp4" }, body: new Uint8Array(big), duplex: "half" } as RequestInit));
    assert.equal(response.status, 413);
    const listed = await (await LIST(new Request(`http://localhost/api/sources?sessionId=${id}`, { headers: { Cookie: cookie } }))).json();
    assert.equal(listed.sources.length, 0);
  } finally { if (previous === undefined) delete process.env.MAX_SOURCE_MB; else process.env.MAX_SOURCE_MB = previous; }
});
