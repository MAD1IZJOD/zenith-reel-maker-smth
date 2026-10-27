// Real HTTPS smoke test. Creates only a new test session with bundled synthetic footage.
// Usage: node scripts/verify-public.mjs https://your-public-entry.example
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const entry = new URL(process.argv[2]);
assert.equal(entry.protocol, "https:");
const landing = await fetch(entry, { signal: AbortSignal.timeout(60_000) });
assert.equal(landing.status, 200, "public landing page");
const base = new URL(landing.url).origin;
console.log(`Public entry resolves to ${base}`);
assert.match(await landing.text(), /ZENITH/);
let cookie = "";
async function request(route, options = {}) {
  return fetch(`${base}${route}`, { ...options, headers: { Origin: base, cookie, ...options.headers }, signal: AbortSignal.timeout(90_000) });
}
async function json(route, options) {
  const response = await request(route, options);
  const body = await response.json();
  assert.ok(response.ok, `${route}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}
assert.equal((await json("/api/ready")).status, "ready");
assert.equal((await json("/api/health")).videoPipeline, "available");
for (const route of ["/operator", "/api/operator", "/api/ai/health"]) assert.equal((await request(route)).status, 404);
assert.equal((await request("/api/sessions", { method: "POST", headers: { Origin: "https://untrusted.example" } })).status, 403);
const sessionResponse = await request("/api/sessions", { method: "POST" });
assert.equal(sessionResponse.status, 200);
assert.match(sessionResponse.headers.get("set-cookie"), /secure/i);
cookie = sessionResponse.headers.get("set-cookie").split(";")[0];
const { sessionId } = await sessionResponse.json();
for (const shot of [1, 2, 3]) {
  const bytes = await readFile(`public/samples/shot-${shot}.mp4`);
  const form = new FormData();
  form.set("sessionId", sessionId); form.set("shot", String(shot));
  form.set("file", new File([bytes], `shot-${shot}.mp4`, { type: "video/mp4" }));
  await json("/api/uploads", { method: "POST", body: form });
  console.log(`PASS public upload ${shot}`);
}
const { job: started } = await json("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, presetId: "main-character" }) });
const deadline = Date.now() + 180_000;
let job;
do {
  ({ job } = await json(`/api/jobs?id=${started.id}`));
  assert.notEqual(job.stage, "failed", job.error);
  if (job.stage === "completed") break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
} while (Date.now() < deadline);
assert.equal(job.stage, "completed", "render must complete before deadline");
const download = await request(job.outputUrl);
assert.equal(download.status, 200);
const dir = path.resolve("data/hosting/verification");
await mkdir(dir, { recursive: true });
const output = path.join(dir, `${started.id}.mp4`);
await writeFile(output, Buffer.from(await download.arrayBuffer()));
const probe = JSON.parse(execFileSync(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-show_streams", "-of", "json", output], { encoding: "utf8", windowsHide: true }));
assert.ok(probe.streams.some((s) => s.codec_name === "h264" && s.width === 720 && s.height === 1280));
assert.ok(probe.streams.some((s) => s.codec_name === "aac"));
const ranged = await request(job.outputUrl, { headers: { Range: "bytes=0-1023" } });
assert.equal(ranged.status, 206); assert.equal((await ranged.arrayBuffer()).byteLength, 1024);
assert.equal((await request(job.outputUrl, { headers: { cookie: "" } })).status, 401);
console.log("PASS HTTPS session, three uploads, real H.264/AAC render, download, range playback, private media, origin and operator guards");
console.log(`Downloaded verification reel: ${output}`);
