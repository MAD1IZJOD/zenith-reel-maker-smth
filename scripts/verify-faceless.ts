import "./isolated-data";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createSessionId, ensureSession } from "../src/lib/storage/session-storage";
import { sourceMediaPath } from "../src/lib/sources/store";
import { readTranscript } from "../src/lib/transcription/service";
import { transcriptWords } from "../src/lib/transcription/schema";
import { highlightsFor } from "../src/lib/highlights/service";
import { planPodcastReel, type VisualStyle } from "../src/lib/edit/planner";
import { executeEdl } from "../src/lib/video/render";
import { ffmpeg, runProcess } from "../src/lib/video/process";
import type { CaptionStyleId } from "../src/lib/edit/styles";
import { inspectExport } from "./verify-aesthetics";
import { ingestFixture, transcribeAndWait } from "./verify-transcription";

/** Renders every faceless style and caption look from real speech, runs objective checks and writes contact sheets. */
async function main() {
  const out = path.join(process.cwd(), "data", "aesthetics", "faceless"); await mkdir(out, { recursive: true });
  const sessionId = createSessionId(); await ensureSession(sessionId);
  const fixtures = path.join(process.cwd(), "data", "fixtures");
  const audioOnly = await ingestFixture(sessionId, path.join(fixtures, "art_of_war_01-02_sun_tzu_64kb.mp3"));
  const video = await ingestFixture(sessionId, path.join(fixtures, "tos-dialogue.mp4"));
  const broll = await Promise.all(["tos-walk-landscape.mp4", "tos-group-portrait.mp4"].map((name) => ingestFixture(sessionId, path.join(fixtures, name))));
  for (const source of [audioOnly, video]) await transcribeAndWait(sessionId, source.id, "en");
  const cases: { source: typeof audioOnly; visual: VisualStyle; caption: CaptionStyleId; withBroll?: boolean; music?: boolean }[] = [
    { source: audioOnly, visual: "minimal", caption: "clean-creator" },
    { source: audioOnly, visual: "cinematic", caption: "cinematic", music: true },
    { source: audioOnly, visual: "broll", caption: "podcast-pop" },
    { source: audioOnly, visual: "broll", caption: "high-energy", withBroll: true, music: true },
    { source: video, visual: "cinematic", caption: "minimal" },
    { source: video, visual: "speaker", caption: "podcast-pop" },
  ];
  const results = [];
  for (const [index, item] of cases.entries()) {
    const transcript = (await readTranscript(sessionId, item.source.id))!;
    const discovery = await highlightsFor(sessionId, item.source.id, { length: "short", tone: "educational" });
    const pick = discovery.selected[index % discovery.selected.length];
    const media = item.source.media!;
    const edl = planPodcastReel({
      source: { duration: media.duration, width: media.width, height: media.height, hasVideo: media.hasVideo, hasAudio: media.hasAudio },
      start: pick.start, end: pick.end, words: transcriptWords(transcript), title: pick.title, hook: pick.hook, visual: item.visual, captionStyle: item.caption, profile: "fast",
      music: item.music ? { musicId: "drift", gain: 0.16 } : undefined, keywords: pick.hashtags.map((tag) => tag.slice(1)),
      broll: item.withBroll ? broll.map((clip) => ({ duration: clip.media!.duration, width: clip.media!.width, height: clip.media!.height, hasVideo: true, hasAudio: clip.media!.hasAudio })) : undefined,
    });
    const name = `${String(index + 1).padStart(2, "0")}-${item.visual}${item.withBroll ? "-own-broll" : ""}-${item.caption}`;
    const output = path.join(out, `${name}.mp4`);
    const started = Date.now();
    await executeEdl(edl, { sourcePaths: [sourceMediaPath(sessionId, item.source.id), ...(item.withBroll ? broll.map((clip) => sourceMediaPath(sessionId, clip.id)) : [])], output, workDirectory: path.join(out, `work-${name}`), coverPrefix: path.join(out, `cover-${name}`) });
    const renderMs = Date.now() - started;
    const inspection = await inspectExport(output, edl);
    await runProcess(ffmpeg(), ["-y", "-v", "error", "-i", output, "-vf", `fps=${(6 / inspection.duration).toFixed(4)},scale=240:-2,tile=6x1`, "-frames:v", "1", path.join(out, `${name}.jpg`)], "Faceless sheet");
    results.push({ name, interval: [pick.start, pick.end], renderMs, captionWords: edl.captions.reduce((sum, group) => sum + group.words.length, 0), duration: inspection.duration, audioRmsDb: inspection.audioRmsDb, blackIntervals: inspection.blackIntervals, size: `${inspection.width}x${inspection.height}` });
    console.log(JSON.stringify(results.at(-1)));
  }
}
void main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
