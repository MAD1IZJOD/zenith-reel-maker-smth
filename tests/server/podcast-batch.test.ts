import "../../scripts/isolated-data";
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import zlib from "node:zlib";
import { issueSession, sessionCookie } from "@/lib/server/security";
import { saveRegistration } from "@/lib/server/registrations";
import { createSessionId, ensureSession } from "@/lib/storage/session-storage";
import { createSource, finishIngest, sourceDirectory, sourceMediaPath } from "@/lib/sources/store";
import { saveImportedTranscript } from "@/lib/transcription/service";
import { ffmpeg, runProcess } from "@/lib/video/process";
import { probeVideo } from "@/lib/video/metadata";
import { POST as HIGHLIGHTS } from "@/app/api/sources/[id]/highlights/route";
import { POST as CREATE } from "@/app/api/podcast/batches/route";
import { GET as VIEW } from "@/app/api/podcast/batches/[id]/route";
import { GET as REEL, POST as EDIT } from "@/app/api/podcast/batches/[id]/reels/[index]/route";
import { GET as ZIP } from "@/app/api/podcast/batches/[id]/zip/route";

/**
 * Pipeline test: a generated 90 s source with a tone soundtrack and an imported timed transcript (so the test does
 * not depend on Whisper). Real-speech end-to-end runs are in scripts/verify-podcast.ts.
 */
const SCRIPT = [
  "Why do most small teams struggle with pricing? The truth is they price for costs instead of value. Customers pay for the outcome you deliver. If you charge for hours, you cap your own growth. The key is to anchor the price to the result.",
  "Let me tell you a story. Years ago I was running a tiny bakery with my sister. One morning the oven broke an hour before opening. We carried every tray across the street. We laughed and somehow sold out by noon.",
  "Here is the most useful habit I know. Never start the day by reading email. You should write down the one task that moves everything forward. Make sure you finish it before lunch. Always protect the first hour.",
];
function transcriptJson() {
  let cursor = 1;
  const segments = SCRIPT.flatMap((paragraph) => {
    const sentences = paragraph.match(/[^.?!]+[.?!]/g)!.map((sentence) => {
      const words = sentence.trim().split(/\s+/).map((text) => { const word = { text, start: Number(cursor.toFixed(3)), end: Number((cursor + 0.32).toFixed(3)) }; cursor += 0.4; return word; });
      cursor += 0.6;
      return { start: words[0].start, end: words.at(-1)!.end, text: sentence.trim(), words };
    });
    cursor += 1.4;
    return sentences;
  });
  return JSON.stringify({ wordTimestamps: true, language: "en", segments });
}
const json = (body: unknown, cookie: string) => ({ method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const params = <T>(value: T) => ({ params: Promise.resolve(value) });

async function waitFor(batchId: string, sessionId: string, cookie: string, done: (reels: { status: string }[]) => boolean) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const view = (await (await VIEW(new Request(`http://localhost/api/podcast/batches/${batchId}?sessionId=${sessionId}`, { headers: { Cookie: cookie } }), params({ id: batchId }))).json()).batch;
    if (done(view.reels)) return view;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Batch did not finish");
}

/** Reads a stored ZIP and checks every entry's CRC-32 and size against the original files. */
function verifyZip(buffer: Buffer): { name: string; size: number; crc: number; data: Buffer }[] {
  const entries = [];
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const crc = buffer.readUInt32LE(offset + 14), size = buffer.readUInt32LE(offset + 18), nameLength = buffer.readUInt16LE(offset + 26), extra = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const data = buffer.subarray(offset + 30 + nameLength + extra, offset + 30 + nameLength + extra + size);
    assert.equal((zlib as unknown as { crc32: (data: Buffer) => number }).crc32(data) >>> 0, crc, `${name} CRC`);
    entries.push({ name, size, crc, data });
    offset += 30 + nameLength + extra + size;
  }
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.equal(buffer.readUInt16LE(end + 10), entries.length, "central directory count");
  return entries;
}

test("one source becomes three independent, downloadable reels with per-reel edits, partial failure and retry", { timeout: 600_000 }, async () => {
  const sessionId = createSessionId(); const { token } = await issueSession(sessionId); const directory = await ensureSession(sessionId);
  await saveRegistration(sessionId, { name: "Pipeline Test", email: "pipeline@example.com", acknowledged: true });
  const cookie = `${sessionCookie(sessionId)}=${token}`;
  const raw = path.join(directory, "fixture-source.mp4");
  await runProcess(ffmpeg(), ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=95", "-f", "lavfi", "-i", "sine=frequency=220:d=95", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", raw], "Podcast fixture");
  const created = await createSource(sessionId, "upload", "Episode fixture.mp4");
  await copyFile(raw, path.join(sourceDirectory(sessionId, created.id), "upload.part"));
  const source = await finishIngest(created, path.join(sourceDirectory(sessionId, created.id), "upload.part"));
  assert.equal(source.status, "ready");
  await saveImportedTranscript(sessionId, source.id, transcriptJson());

  const highlights = await (await HIGHLIGHTS(new Request("http://localhost", json({ sessionId, preferences: { length: "short", tone: "general" } }, cookie)), params({ id: source.id }))).json();
  assert.equal(highlights.selected.length, 3, highlights.notice);
  assert.ok(!("features" in highlights.selected[0]), "internal scoring details stay server-side");
  const reels = highlights.selected.map((item: { id: string }) => ({ candidateId: item.id }));

  // Invalid requests are rejected before anything renders.
  assert.equal((await CREATE(new Request("http://localhost", json({ sessionId, sourceId: source.id, reels: [{ candidateId: "0000000000000000" }] }, cookie)))).status, 400);
  assert.equal((await CREATE(new Request("http://localhost", json({ sessionId, sourceId: source.id, reels: [reels[0], reels[0]] }, cookie)))).status, 400);
  assert.equal((await CREATE(new Request("http://localhost", json({ sessionId, sourceId: source.id, reels: [...reels, reels[0]] }, cookie)))).status, 400);

  const response = await CREATE(new Request("http://localhost", json({ sessionId, sourceId: source.id, preferences: { length: "short", tone: "general" }, style: { visual: "minimal", captionStyle: "podcast-pop", soundtrack: "drift", musicVolume: 0.15 }, reels }, cookie)));
  assert.equal(response.status, 202);
  const batch = (await response.json()).batch;
  const finished = await waitFor(batch.id, sessionId, cookie, (items) => items.every((reel) => ["completed", "failed"].includes(reel.status)));
  assert.equal(finished.completed, 3, JSON.stringify(finished.reels.map((reel: { error?: string }) => reel.error)));

  const hashes = new Set<string>();
  for (const reel of finished.reels) {
    const download = await REEL(new Request(`http://localhost${reel.downloadUrl}`, { headers: { Cookie: cookie } }), params({ id: batch.id, index: String(reel.index) }));
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition")!, new RegExp(`zenith-reel-0${reel.index}\\.mp4`));
    const bytes = Buffer.from(await download.arrayBuffer());
    hashes.add(createHash("sha256").update(bytes).digest("hex"));
    const file = path.join(directory, `check-${reel.index}.mp4`); await writeFile(file, bytes);
    const metadata = await probeVideo(file);
    assert.equal(metadata.codecName, "h264"); assert.equal(metadata.width, 720); assert.equal(metadata.height, 1280); assert.equal(metadata.hasAudio, true);
    assert.ok(Math.abs(metadata.duration - (reel.end - reel.start)) < 0.2, `duration ${metadata.duration} vs ${reel.end - reel.start}`);
  }
  assert.equal(hashes.size, 3, "three different files");
  const intervals = finished.reels.map((reel: { start: number; end: number }) => [reel.start, reel.end]);
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) assert.ok(Math.min(intervals[a][1], intervals[b][1]) <= Math.max(intervals[a][0], intervals[b][0]) + 0.5, "distinct source intervals");

  const zip = verifyZip(Buffer.from(await (await ZIP(new Request(`http://localhost/api/podcast/batches/${batch.id}/zip?sessionId=${sessionId}`, { headers: { Cookie: cookie } }), params({ id: batch.id }))).arrayBuffer()));
  assert.deepEqual(zip.map((entry) => entry.name), ["zenith-reel-01.mp4", "zenith-reel-02.mp4", "zenith-reel-03.mp4"]);

  // Editing reel 1's title re-renders only reel 1; reels 2 and 3 keep their jobs and files.
  const before = finished.reels.map((reel: { jobId: string }) => reel.jobId);
  const edited = (await (await EDIT(new Request("http://localhost", json({ sessionId, changes: { title: "Price for the result" } }, cookie)), params({ id: batch.id, index: "1" }))).json()).batch;
  assert.notEqual(edited.reels[0].jobId, before[0]); assert.equal(edited.reels[0].revision, 2); assert.equal(edited.reels[0].title, "Price for the result");
  assert.deepEqual(edited.reels.slice(1).map((reel: { jobId: string }) => reel.jobId), before.slice(1));

  // Partial failure: reel 2 switches to b-roll from a clip whose file then disappears. Its render fails; others survive.
  const brollCreated = await createSource(sessionId, "upload", "broll.mp4");
  await copyFile(raw, path.join(sourceDirectory(sessionId, brollCreated.id), "upload.part"));
  const broll = await finishIngest(brollCreated, path.join(sourceDirectory(sessionId, brollCreated.id), "upload.part"));
  const batchFile = path.join(directory, "batches", `${batch.id}.json`);
  const stored = JSON.parse(await readFile(batchFile, "utf8")); stored.brollIds = [broll.id]; await writeFile(batchFile, JSON.stringify(stored));
  await rm(sourceMediaPath(sessionId, broll.id), { force: true }).catch(() => undefined);
  const failing = await EDIT(new Request("http://localhost", json({ sessionId, style: { visual: "broll" } }, cookie)), params({ id: batch.id, index: "2" }));
  assert.equal(failing.status, 202);
  const partial = await waitFor(batch.id, sessionId, cookie, (items) => items.every((reel) => ["completed", "failed"].includes(reel.status)));
  assert.deepEqual(partial.reels.map((reel: { status: string }) => reel.status), ["completed", "failed", "completed"]);
  assert.match(partial.reels[1].error, /other reels/);
  assert.equal(verifyZip(Buffer.from(await (await ZIP(new Request(`http://localhost/api/podcast/batches/${batch.id}/zip?sessionId=${sessionId}`, { headers: { Cookie: cookie } }), params({ id: batch.id }))).arrayBuffer())).length, 2, "archive holds only finished reels");

  // Retry just reel 2 with a working style.
  await EDIT(new Request("http://localhost", json({ sessionId, style: { visual: "minimal" } }, cookie)), params({ id: batch.id, index: "2" }));
  const recovered = await waitFor(batch.id, sessionId, cookie, (items) => items.every((reel) => ["completed", "failed"].includes(reel.status)));
  assert.equal(recovered.completed, 3);

  // Another visitor can reach neither the batch nor its reels.
  const other = createSessionId(); const otherAccess = await issueSession(other); await ensureSession(other);
  const otherCookie = `${sessionCookie(other)}=${otherAccess.token}`;
  assert.equal((await VIEW(new Request(`http://localhost/api/podcast/batches/${batch.id}?sessionId=${sessionId}`, { headers: { Cookie: otherCookie } }), params({ id: batch.id }))).status, 401);
  assert.equal((await VIEW(new Request(`http://localhost/api/podcast/batches/${batch.id}?sessionId=${other}`, { headers: { Cookie: otherCookie } }), params({ id: batch.id }))).status, 404);
  assert.equal((await REEL(new Request(`http://localhost/api/podcast/batches/${batch.id}/reels/1?sessionId=${other}`, { headers: { Cookie: otherCookie } }), params({ id: batch.id, index: "1" }))).status, 404);
  assert.equal((await ZIP(new Request(`http://localhost/api/podcast/batches/${batch.id}/zip?sessionId=${sessionId}`, { headers: { Cookie: otherCookie } }), params({ id: batch.id }))).status, 401);
});
