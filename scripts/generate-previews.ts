import "./isolated-data";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PRESETS } from "../src/lib/presets";
import { renderReel } from "../src/lib/video/render";
import { probeVideo } from "../src/lib/video/metadata";
import { ffmpeg, runProcess } from "../src/lib/video/process";
import { prepareFixtureSession } from "./fixtures";

/**
 * Style previews shown on the preset cards, rendered by the real engine. With `npm run fixtures:fetch` they use
 * Tears of Steel footage (c) Blender Foundation | mango.blender.org, CC BY 3.0, so visitors can see how each style
 * treats real people; otherwise camera-like synthetic clips are used. Never visitor footage.
 */
async function main() {
  const session = await prepareFixtureSession("portrait");
  const target = path.join(process.cwd(), "public", "previews"); await mkdir(target, { recursive: true });
  for (const [index, preset] of PRESETS.entries()) {
    // Covers alternate between the opening, middle and final moments so the cards are distinguishable at a glance.
    const result = await renderReel({ sessionId: session.sessionId, presetId: preset.id, outputName: `${preset.id}.mp4`, audioMode: "original", coverFrame: ([1, 2, 0][index % 3]) as 0 | 1 | 2 });
    // Previews are compressed for the web: 540 x 960 is plenty for a card-sized player.
    await runProcess(ffmpeg(), ["-y", "-v", "error", "-i", result.output, "-vf", "scale=540:960:flags=lanczos", "-c:v", "libx264", "-preset", "slow", "-crf", "27", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", path.join(target, `${preset.id}.mp4`)], "Preview encode");
    await runProcess(ffmpeg(), ["-y", "-v", "error", "-i", result.cover, "-vf", "scale=432:768:flags=lanczos", "-q:v", "4", path.join(target, `${preset.id}.jpg`)], "Preview cover");
    const metadata = await probeVideo(path.join(target, `${preset.id}.mp4`)); console.log(`${preset.id}: ${metadata.width}x${metadata.height} ${metadata.codecName} ${metadata.duration}s`);
  }
  await writeFile(path.join(target, "ATTRIBUTION.txt"), session.real
    ? "Preview edits rendered by Zenith from \"Tears of Steel\" (c) Blender Foundation | mango.blender.org, licensed CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/). Edited: cropped, trimmed, colour graded and titled.\n"
    : "Preview edits rendered by Zenith from original synthetic sample clips.\n");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
