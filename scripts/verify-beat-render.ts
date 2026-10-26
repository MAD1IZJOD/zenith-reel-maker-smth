import "./isolated-data";
import assert from "node:assert/strict";
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { createSessionId, ensureSession } from "../src/lib/storage/session-storage";
import { renderReel } from "../src/lib/video/render";
import { probeVideo } from "../src/lib/video/metadata";
import { runProcess, ffmpeg } from "../src/lib/video/process";
import { createTimeline } from "../src/lib/creative/timeline";
import { defaultCreativeOptions } from "../src/lib/creative/options";
import { PRESETS } from "../src/lib/presets";

async function main() {
  const sessionId = createSessionId(), directory = await ensureSession(sessionId);
  await Promise.all([1, 2, 3].map((i) => copyFile(path.resolve(`public/samples/shot-${i}.mp4`), path.join(directory, `shot-${i}.mp4`))));
  const results = [];
  for (const syncMode of ["energetic", "cinematic"] as const) {
    const options = { ...defaultCreativeOptions(PRESETS[0]), audioMode: "soundtrack" as const, syncMode };
    const timeline = createTimeline(PRESETS[0], options);
    const result = await renderReel({ sessionId, presetId: "main-character", ...options, outputName: `beat-${syncMode}.mp4` });
    const metadata = await probeVideo(result.output);
    assert.ok(Math.abs(metadata.duration - timeline.totalDuration) < 0.1, `${metadata.duration} vs ${timeline.totalDuration}`);
    await runProcess(ffmpeg(), ["-v", "error", "-i", result.output, "-f", "null", "-"], "Beat export full decode");
    // Actual decoded audio has a nonzero sample checksum; this does not mistake an AAC silence track for music.
    const audio = await runProcess(ffmpeg(), ["-v", "error", "-i", result.output, "-map", "0:a:0", "-af", "astats=metadata=1:reset=0,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=-", "-f", "null", "-"], "Music signal verification");
    assert.match(audio, /RMS_level=-\d+\./);
    results.push({ mode: syncMode, output: result.output, duration: metadata.duration, cuts: timeline.cutPositions, audio: "non-silent decoded AAC" });
  }
  assert.notEqual(results[0].duration, results[1].duration); console.log(JSON.stringify(results, null, 2));
}
void main();
