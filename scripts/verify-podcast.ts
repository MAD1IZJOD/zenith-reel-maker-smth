import "./isolated-data";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { issueSession, sessionCookie } from "../src/lib/server/security";
import { createSessionId, ensureSession } from "../src/lib/storage/session-storage";
import { ffmpeg, runProcess } from "../src/lib/video/process";
import { probeVideo } from "../src/lib/video/metadata";
import { POST as HIGHLIGHTS } from "../src/app/api/sources/[id]/highlights/route";
import { POST as CREATE } from "../src/app/api/podcast/batches/route";
import { GET as VIEW } from "../src/app/api/podcast/batches/[id]/route";
import { GET as REEL } from "../src/app/api/podcast/batches/[id]/reels/[index]/route";
import { GET as ZIP } from "../src/app/api/podcast/batches/[id]/zip/route";
import { ingestFixture, transcribeAndWait } from "./verify-transcription";
import { withPeakMemory } from "./benchmark-render";

/**
 * The Stage 2 demonstration on real speech: one recording -> transcription -> three highlights -> three faceless,
 * captioned reels -> downloads and ZIP. Stage timings are measured; outputs are copied to data/demo for review.
 * Arguments: fixture name (default: public-domain LibriVox "The Art of War", ch. 1-2), visual style, length preset.
 */
async function main() {
  const fixture = process.argv[2] || "art_of_war_01-02_sun_tzu_64kb.mp3", visual = process.argv[3] || "minimal", length = process.argv[4] || "short";
  const out = path.join(process.cwd(), "data", "demo", `${path.parse(fixture).name}-${visual}`); await mkdir(out, { recursive: true });
  const sessionId = createSessionId(); const { token } = await issueSession(sessionId); await ensureSession(sessionId);
  const cookie = `${sessionCookie(sessionId)}=${token}`;
  const timings: Record<string, number> = {};
  let started = Date.now();
  const source = await ingestFixture(sessionId, path.join(process.cwd(), "data", "fixtures", fixture));
  timings.ingestMs = Date.now() - started;
  started = Date.now();
  const transcription = await withPeakMemory(() => transcribeAndWait(sessionId, source.id, "en"), ["python"]);
  assert.equal(transcription.value.record.transcript.status, "ready");
  timings.transcribeMs = Date.now() - started; timings.transcribePeakMB = transcription.peakMb ?? 0;
  started = Date.now();
  const analysis = await withPeakMemory(async () => (await HIGHLIGHTS(new Request("http://localhost", { method: "POST", headers: { Cookie: cookie }, body: JSON.stringify({ sessionId, preferences: { length, tone: "educational" } }) }), { params: Promise.resolve({ id: source.id }) })).json(), ["ollama", "llama-server"]);
  const highlights = analysis.value;
  timings.highlightMs = Date.now() - started; timings.analysisPeakMB = analysis.peakMb ?? 0;
  assert.ok(highlights.selected.length >= 1, highlights.notice);
  started = Date.now();
  const created = await (await CREATE(new Request("http://localhost", { method: "POST", headers: { Cookie: cookie }, body: JSON.stringify({ sessionId, sourceId: source.id, preferences: { length, tone: "educational" }, style: { visual, captionStyle: visual === "cinematic" ? "cinematic" : "clean-creator", soundtrack: "drift", musicVolume: 0.14 }, reels: highlights.selected.map((item: { id: string }) => ({ candidateId: item.id })) }) }))).json();
  assert.ok(created.batch, JSON.stringify(created));
  const firstReady: number[] = [];
  const waitBatch = async (initial: typeof created.batch, marks: number[], since: number) => {
    let current = initial;
    while (!current.reels.every((reel: { status: string }) => ["completed", "failed"].includes(reel.status))) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      current = (await (await VIEW(new Request(`http://localhost/api/podcast/batches/${current.id}?sessionId=${sessionId}`, { headers: { Cookie: cookie } }), { params: Promise.resolve({ id: current.id }) })).json()).batch;
      if (current.completed > marks.length) marks.push(Date.now() - since);
    }
    return current;
  };
  const rendered = await withPeakMemory(() => waitBatch(created.batch, firstReady, started));
  const view = rendered.value;
  timings.batchMs = Date.now() - started; timings.renderPeakMB = rendered.peakMb ?? 0;
  const reels = [];
  for (const reel of view.reels) {
    assert.equal(reel.status, "completed", reel.error);
    const response = await REEL(new Request(`http://localhost${reel.downloadUrl}`, { headers: { Cookie: cookie } }), { params: Promise.resolve({ id: view.id, index: String(reel.index) }) });
    const file = path.join(out, `zenith-reel-0${reel.index}.mp4`);
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
    const metadata = await probeVideo(file);
    await runProcess(ffmpeg(), ["-y", "-v", "error", "-i", file, "-vf", `fps=${(6 / metadata.duration).toFixed(4)},scale=240:-2,tile=6x1`, "-frames:v", "1", path.join(out, `zenith-reel-0${reel.index}.jpg`)], "Demo sheet");
    reels.push({ reel: reel.index, role: reel.role, interval: `${reel.start.toFixed(1)}–${reel.end.toFixed(1)} s`, duration: metadata.duration, title: reel.title, hook: reel.hook, renderMs: reel.renderMs, sizeMB: Number(((reel.sizeBytes || 0) / 1048576).toFixed(2)), video: `${metadata.codecName} ${metadata.width}x${metadata.height}`, audio: metadata.hasAudio, file });
  }
  // Warm path: another look for the same recording reuses the transcript and cached analysis; only rendering runs.
  started = Date.now();
  await HIGHLIGHTS(new Request("http://localhost", { method: "POST", headers: { Cookie: cookie }, body: JSON.stringify({ sessionId, preferences: { length, tone: "educational" } }) }), { params: Promise.resolve({ id: source.id }) });
  timings.warmHighlightMs = Date.now() - started;
  started = Date.now();
  const second = await (await CREATE(new Request("http://localhost", { method: "POST", headers: { Cookie: cookie }, body: JSON.stringify({ sessionId, sourceId: source.id, preferences: { length, tone: "educational" }, style: { visual: visual === "minimal" ? "cinematic" : "minimal", captionStyle: "podcast-pop", soundtrack: "none" }, reels: highlights.selected.map((item: { id: string }) => ({ candidateId: item.id })) }) }))).json();
  const warmMarks: number[] = [];
  const warm = await waitBatch(second.batch, warmMarks, started);
  assert.equal(warm.completed, warm.reels.length);
  timings.warmBatchMs = Date.now() - started; timings.warmFirstReelReadyMs = warmMarks[0];
  const zip = await ZIP(new Request(`http://localhost/api/podcast/batches/${view.id}/zip?sessionId=${sessionId}`, { headers: { Cookie: cookie } }), { params: Promise.resolve({ id: view.id }) });
  await writeFile(path.join(out, "zenith-reels.zip"), Buffer.from(await zip.arrayBuffer()));
  const report = { fixture, visual, length, sourceSeconds: source.media!.duration, rankedBy: highlights.rankedBy, model: highlights.model, modelLatencyMs: highlights.modelLatencyMs, fallbackReason: highlights.fallbackReason, timings: { ...timings, firstReelReadyMs: firstReady[0] }, reels, zipBytes: (await readFile(path.join(out, "zenith-reels.zip"))).length };
  await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
void main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
