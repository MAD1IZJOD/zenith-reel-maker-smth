import "./isolated-data";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { PRESETS } from "../src/lib/presets";
import { createSessionId, ensureSession } from "../src/lib/storage/session-storage";
import { renderReel } from "../src/lib/video/render";
import { probeVideo } from "../src/lib/video/metadata";

// Only generated, bundled synthetic samples enter public previews; never visitor footage.
async function main() {
  const sessionId = createSessionId(); const directory = await ensureSession(sessionId);
  await Promise.all([1, 2, 3].map((shot) => copyFile(path.join(process.cwd(), "public", "samples", `shot-${shot}.mp4`), path.join(directory, `shot-${shot}.mp4`))));
  const target = path.join(process.cwd(), "public", "previews"); await mkdir(target, { recursive: true });
  for (const preset of PRESETS) {
    const result = await renderReel({ sessionId, presetId: preset.id, outputName: `${preset.id}.mp4` });
    await copyFile(result.output, path.join(target, `${preset.id}.mp4`)); await copyFile(result.cover, path.join(target, `${preset.id}.jpg`));
    const metadata = await probeVideo(result.output); console.log(`${preset.id}: ${metadata.width}x${metadata.height} ${metadata.codecName} ${metadata.duration}s`);
  }
}
void main();
