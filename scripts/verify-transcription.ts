import "./isolated-data";
import assert from "node:assert/strict";
import { access, copyFile } from "node:fs/promises";
import path from "node:path";
import { createSessionId, ensureSession } from "../src/lib/storage/session-storage";
import { createSource, finishIngest, readSource, sourceDirectory } from "../src/lib/sources/store";
import { readTranscript, startTranscription } from "../src/lib/transcription/service";
import { transcriptWords } from "../src/lib/transcription/schema";
import { whisperConfig } from "../src/lib/transcription/faster-whisper";

/** Real local transcription of real speech (Tears of Steel dialogue, CC-BY; `npm run fixtures:fetch`). */
async function main() {
  const fixture = path.join(process.cwd(), "data", "fixtures", "tos-dialogue.mp4");
  await access(fixture).catch(() => { throw new Error("Run `npm run fixtures:fetch` first to download the CC-BY dialogue fixture."); });
  const sessionId = createSessionId(); await ensureSession(sessionId);
  const created = await createSource(sessionId, "upload", "tos-dialogue.mp4");
  const part = path.join(sourceDirectory(sessionId, created.id), "upload.part");
  await copyFile(fixture, part);
  const source = await finishIngest(created, part);
  assert.equal(source.status, "ready", source.error);
  const started = Date.now();
  await startTranscription(sessionId, source.id, "en");
  let record = await readSource(sessionId, source.id);
  while (record.transcript.status === "queued" || record.transcript.status === "running") { await new Promise((resolve) => setTimeout(resolve, 1000)); record = await readSource(sessionId, source.id); }
  const wallMs = Date.now() - started;
  assert.equal(record.transcript.status, "ready", record.transcript.error);
  const transcript = (await readTranscript(sessionId, source.id))!;
  const words = transcriptWords(transcript);
  assert.ok(words.length > 20, "expected real speech");
  for (const [index, word] of words.entries()) { assert.ok(word.end >= word.start); if (index) assert.ok(word.start >= words[index - 1].start - 0.01, "words in order"); assert.ok(word.end <= transcript.duration + 0.5); }
  // A second request must reuse the stored transcript instead of transcribing again.
  const reuseStarted = Date.now();
  const again = await startTranscription(sessionId, source.id, "en");
  assert.equal(again.transcript.status, "ready");
  console.log(JSON.stringify({ sessionId, sourceId: source.id, model: whisperConfig().model, mediaSeconds: source.media!.duration, transcriptionWallMs: wallMs, realTimeFactor: Number((wallMs / 1000 / source.media!.duration).toFixed(2)), reuseMs: Date.now() - reuseStarted, language: transcript.language, segments: transcript.segments.length, words: words.length, firstWords: words.slice(0, 12).map((word) => `${word.text}@${word.start.toFixed(2)}`) }, null, 2));
}
void main().catch((error) => { console.error(error.message || error); process.exitCode = 1; });
