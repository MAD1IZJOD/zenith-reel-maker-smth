import "./isolated-data";
import assert from "node:assert/strict";
import { access, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createSessionId, ensureSession } from "../src/lib/storage/session-storage";
import { createSource, finishIngest, readSource, sourceDirectory, sourceMediaPath } from "../src/lib/sources/store";
import { readTranscript, startTranscription } from "../src/lib/transcription/service";
import { transcriptWords } from "../src/lib/transcription/schema";
import { candidateWindows, selectNonOverlapping, validateCandidate } from "../src/lib/highlights/candidates";
import { planHighlightEdit } from "../src/lib/edit/planner";
import { executeEdl } from "../src/lib/video/render";
import { ffmpeg, runProcess } from "../src/lib/video/process";
import { inspectExport } from "./verify-aesthetics";
import type { CaptionStyleId } from "../src/lib/edit/styles";

/**
 * Stage 2 foundation, end to end on real speech: ingest -> local transcription -> sentence-aligned candidates
 * -> one highlight rendered as a 9:16 reel with word-timed captions. Frames are saved for visual review.
 */
async function main() {
  const fixture = path.join(process.cwd(), "data", "fixtures", "tos-dialogue.mp4");
  await access(fixture).catch(() => { throw new Error("Run `npm run fixtures:fetch` first."); });
  const sessionId = createSessionId(); await ensureSession(sessionId);
  const created = await createSource(sessionId, "upload", "dialogue.mp4");
  const part = path.join(sourceDirectory(sessionId, created.id), "upload.part");
  await copyFile(fixture, part);
  const source = await finishIngest(created, part);
  await startTranscription(sessionId, source.id, "en");
  let record = await readSource(sessionId, source.id);
  while (["queued", "running"].includes(record.transcript.status)) { await new Promise((resolve) => setTimeout(resolve, 1000)); record = await readSource(sessionId, source.id); }
  const transcript = (await readTranscript(sessionId, source.id))!;
  const pool = candidateWindows(source.id, transcript, { minSeconds: 10, maxSeconds: 30, captionStyle: "podcast-pop" });
  const [best] = selectNonOverlapping(pool, 1);
  assert.ok(best, "a highlight candidate"); assert.deepEqual(validateCandidate(best, transcript, { minSeconds: 10, maxSeconds: 30, captionStyle: "podcast-pop" }), []);
  const out = path.join(process.cwd(), "data", "aesthetics", "highlights"); await mkdir(out, { recursive: true });
  const results = [];
  for (const [style, profile] of [["podcast-pop", "fast"], ["clean-creator", "fast"], ["high-energy", "quality"]] as [CaptionStyleId, "fast" | "quality"][]) {
    const edl = planHighlightEdit({ source: { duration: source.media!.duration, width: source.media!.width!, height: source.media!.height!, hasAudio: true }, start: best.start, end: best.end, words: transcriptWords(transcript), hook: best.hook, captionStyle: style, profile, music: { musicId: "drift", gain: 0.2 } });
    const output = path.join(out, `highlight-${style}-${profile}.mp4`);
    const started = Date.now();
    await executeEdl(edl, { sourcePaths: [sourceMediaPath(sessionId, source.id)], output, workDirectory: path.join(out, `work-${style}`), coverPrefix: path.join(out, `cover-${style}`) });
    const renderMs = Date.now() - started;
    const inspection = await inspectExport(output, edl);
    await runProcess(ffmpeg(), ["-y", "-v", "error", "-i", output, "-vf", `fps=${(8 / inspection.duration).toFixed(4)},scale=200:-2,tile=8x1`, "-frames:v", "1", path.join(out, `highlight-${style}-${profile}.jpg`)], "Highlight sheet");
    results.push({ style, profile, renderMs, captionGroups: edl.captions.length, captionWords: edl.captions.reduce((sum, group) => sum + group.words.length, 0), ...inspection });
  }
  console.log(JSON.stringify({ candidate: { start: best.start, end: best.end, hook: best.hook, engagement: best.estimatedEngagement, rationale: best.rationale, transcript: best.transcript }, windows: pool.length, results }, null, 2));
}
void main().catch((error) => { console.error(error.message || error); process.exitCode = 1; });
