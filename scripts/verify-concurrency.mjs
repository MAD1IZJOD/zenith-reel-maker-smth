// Bounded multi-visitor check against a real production server it starts itself (isolated data, port 3313):
// N simulated visitors upload three clips each at the same moment, then all press Generate together. Reports upload
// refusals, retries, queue waits, render times, peak memory (server + FFmpeg) and verifies every finished MP4.
// Usage: node scripts/verify-concurrency.mjs [visitors=4]   (after npm run build). Keep N small on a laptop.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const visitors = Math.max(1, Math.min(10, Number(process.argv[2]) || 4));
const port = 3313, base = `http://127.0.0.1:${port}`;
const data = mkdtempSync(path.join(os.tmpdir(), "zenith-load-"));
const env = { ...process.env, NODE_ENV: "production", PORT: String(port), HOSTNAME: "127.0.0.1", COOKIE_SECURE: "false", PUBLIC_BASE_URL: base, DATA_DIR: data, CREATIVE_MODEL_PROVIDER: "off", PODCAST_MODE: "off" };
const server = spawn(process.execPath, ["scripts/serve.mjs"], { env, stdio: "ignore", windowsHide: true });
const clips = [1, 2, 3].map((shot) => readFileSync(path.resolve("public", "samples", `shot-${shot}.mp4`)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Peak resident memory of the server process and every FFmpeg child (Windows tasklist; ps elsewhere).
let peakMb = 0, sampling = true;
function memoryMb() {
  try {
    if (process.platform === "win32") {
      const rows = execFileSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8" }).split(/\r?\n/).map((line) => line.split('","').map((cell) => cell.replace(/"/g, "")));
      return rows.filter((row) => (row[1] === String(server.pid)) || /^ffmpeg(\.exe)?$/i.test(row[0])).reduce((sum, row) => sum + Number((row[4] || "0").replace(/[^\d]/g, "")) / 1024, 0);
    }
    return execFileSync("ps", ["-o", "rss=", "-p", String(server.pid)], { encoding: "utf8" }).split("\n").reduce((sum, value) => sum + (Number(value) || 0) / 1024, 0);
  } catch { return 0; }
}
const sampler = (async () => { while (sampling) { peakMb = Math.max(peakMb, memoryMb()); await sleep(250); } })();

async function ready() { for (let i = 0; i < 120; i++) { try { if ((await fetch(`${base}/api/ready`)).ok) return; } catch { /* starting */ } await sleep(500); } throw new Error("server did not start"); }

async function visitor(index) {
  const session = await fetch(`${base}/api/sessions`, { method: "POST", headers: { Origin: base } });
  const { sessionId } = await session.json(); const cookie = (session.headers.get("set-cookie") || "").split(";")[0];
  const result = { index, refused: 0, uploadMs: 0, queueMs: 0, renderMs: 0, totalMs: 0, ok: false, error: "" };
  const started = Date.now();
  await Promise.all(clips.map(async (bytes, shot) => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const form = new FormData(); form.append("sessionId", sessionId); form.append("shot", String(shot + 1)); form.append("file", new File([bytes], `shot-${shot + 1}.mp4`, { type: "video/mp4" }));
      const response = await fetch(`${base}/api/uploads`, { method: "POST", headers: { cookie, Origin: base }, body: form });
      await response.arrayBuffer();
      if (response.ok) return;
      if (response.status !== 429) throw new Error(`upload ${response.status}`);
      result.refused++; await sleep(1000 + Math.random() * 1000);
    }
    throw new Error("upload never admitted");
  }));
  result.uploadMs = Date.now() - started;
  return { result, sessionId, cookie };
}

let exit = 0;
try {
  await ready();
  const t0 = Date.now();
  const sessions = await Promise.all(Array.from({ length: visitors }, (_, index) => visitor(index)));
  const generateAt = Date.now();
  const jobs = await Promise.all(sessions.map(async ({ sessionId, cookie, result }) => {
    const response = await fetch(`${base}/api/jobs`, { method: "POST", headers: { cookie, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, presetId: ["main-character", "beat-sync", "glow-up", "plot-twist", "retro-cam", "squad-montage", "movie-trailer"][result.index % 7] }) });
    const body = await response.json(); if (!response.ok) throw new Error(`job ${response.status} ${body.error}`);
    return { id: body.job.id, cookie, result };
  }));
  await Promise.all(jobs.map(async ({ id, cookie, result }) => {
    for (;;) {
      const { job } = await (await fetch(`${base}/api/jobs?id=${id}`, { headers: { cookie } })).json();
      if (job.stage === "completed" || job.stage === "failed") {
        result.totalMs = Date.now() - generateAt; result.queueMs = job.metrics?.queueWaitMs ?? 0; result.renderMs = job.metrics?.renderDurationMs ?? 0;
        if (job.stage === "failed") { result.error = job.error; return; }
        const mp4 = Buffer.from(await (await fetch(`${base}${job.outputUrl}`, { headers: { cookie } })).arrayBuffer());
        const file = path.join(data, `check-${id}.mp4`); writeFileSync(file, mp4);
        const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height", "-of", "json", file], { encoding: "utf8" }));
        const video = probe.streams.find((stream) => stream.codec_type === "video");
        result.ok = video?.codec_name === "h264" && video.width === 720 && video.height === 1280 && probe.streams.some((stream) => stream.codec_type === "audio");
        return;
      }
      await sleep(400);
    }
  }));
  sampling = false; await sampler;
  const rows = jobs.map((job) => job.result);
  for (const row of rows) console.log(`visitor ${row.index + 1}: uploads ${(row.uploadMs / 1000).toFixed(1)} s (${row.refused} busy refusals), queue ${(row.queueMs / 1000).toFixed(1)} s, render ${(row.renderMs / 1000).toFixed(1)} s, ready ${(row.totalMs / 1000).toFixed(1)} s after Generate, ${row.ok ? "valid MP4" : `FAILED ${row.error}`}`);
  console.log(`${visitors} visitors: all uploaded and rendered in ${((Date.now() - t0) / 1000).toFixed(1)} s; peak memory server+FFmpeg ${Math.round(peakMb)} MB; busy refusals ${rows.reduce((sum, row) => sum + row.refused, 0)}`);
  exit = rows.every((row) => row.ok) ? 0 : 1;
} catch (error) { console.error(error); exit = 1; }
finally { sampling = false; server.kill(); await sleep(800); rmSync(data, { recursive: true, force: true }); }
process.exitCode = exit;
