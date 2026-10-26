import "./isolated-data";
import path from "node:path";
import { createSessionId, ensureSession } from "../src/lib/storage/session-storage";
import { sourceDirectory, sourceMediaPath } from "../src/lib/sources/store";
import { readTranscript } from "../src/lib/transcription/service";
import { discoverHighlights, type LengthPreset, type Tone } from "../src/lib/highlights/discover";
import { audioProfile } from "../src/lib/highlights/audio-profile";
import { ingestFixture, transcribeAndWait } from "./verify-transcription";

/** Highlight discovery on a real recording: prints the three selections and why, for editorial review. */
async function main() {
  const fixture = path.join(process.cwd(), "data", "fixtures", process.argv[2] || "art_of_war_01-02_sun_tzu_64kb.mp3");
  const sessionId = createSessionId(); await ensureSession(sessionId);
  const source = await ingestFixture(sessionId, fixture);
  await transcribeAndWait(sessionId, source.id, "en");
  const transcript = (await readTranscript(sessionId, source.id))!;
  const profileStarted = Date.now();
  const profile = await audioProfile(sourceDirectory(sessionId, source.id), sourceMediaPath(sessionId, source.id));
  const profileMs = Date.now() - profileStarted;
  for (const length of (process.argv[3] ? [process.argv[3]] : ["short", "medium"]) as LengthPreset[]) {
    const result = await discoverHighlights({ sourceId: source.id, sourceLabel: source.label, transcript, preferences: { length, tone: (process.argv[4] || "educational") as Tone }, profile });
    console.log(JSON.stringify({ length, profileMs, windows: result.windows, rankedBy: result.rankedBy, fallbackReason: result.fallbackReason, analysisMs: result.analysisMs, notice: result.notice, selected: result.selected.map((item) => ({ role: item.role, start: item.start, end: item.end, score: item.editorialScore, reasons: item.reasons, title: item.title, hook: item.hook, hashtags: item.hashtags, text: item.transcript.slice(0, 260) })) }, null, 2));
  }
}
void main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
