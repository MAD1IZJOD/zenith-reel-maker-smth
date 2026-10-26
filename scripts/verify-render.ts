import "./isolated-data";
import { copyFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { PRESETS } from "../src/lib/presets";
import { createSessionId, ensureSession } from "../src/lib/storage/session-storage";
import { probeVideo } from "../src/lib/video/metadata";
import { renderReel } from "../src/lib/video/render";
import { ffmpeg, ffprobe, runProcess } from "../src/lib/video/process";

type VerifiedExport = { preset: string; output: string; duration: number; sha256: string };

async function seedSession(): Promise<{ sessionId: string; directory: string }> {
  const sessionId = createSessionId();
  const directory = await ensureSession(sessionId);
  await Promise.all([1, 2, 3].map((shot) => copyFile(path.join(process.cwd(), "public", "samples", `shot-${shot}.mp4`), path.join(directory, `shot-${shot}.mp4`))));
  return { sessionId, directory };
}

async function main() {
  const results: VerifiedExport[] = [];
  for (const preset of PRESETS) {
    const { sessionId } = await seedSession();
    const result = await renderReel({ sessionId, presetId: preset.id, title: `VERIFY ${preset.name}` });
    const [metadata, file] = await Promise.all([probeVideo(result.output), stat(result.output)]);
    const streams = JSON.parse(await runProcess(ffprobe(), ["-v", "error", "-show_entries", "stream=codec_type,codec_name,avg_frame_rate", "-of", "json", result.output], "Export codec verification")).streams as { codec_type: string; codec_name: string; avg_frame_rate: string }[];
    if (!streams.some((stream) => stream.codec_type === "audio" && stream.codec_name === "aac") || !streams.some((stream) => stream.codec_type === "video" && stream.avg_frame_rate === "30/1")) throw new Error(`${preset.name} did not produce AAC audio and consistent 30fps video.`);
    await runProcess(ffmpeg(), ["-v", "error", "-xerror", "-i", result.output, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"], "Full MP4 decode verification");
    if (metadata.width !== 720 || metadata.height !== 1280 || metadata.codecName !== "h264" || metadata.duration <= 0 || file.size < 1_024) {
      throw new Error(`${preset.name} did not produce a valid 720×1280 H.264 MP4: ${JSON.stringify({ metadata, bytes: file.size })}`);
    }
    if (result.covers.length !== 3) throw new Error(`${preset.name} did not produce three cover candidates.`);
    const covers = await Promise.all(result.covers.map((cover) => stat(cover)));
    if (covers.some((cover) => cover.size < 1_024)) throw new Error(`${preset.name} did not produce usable cover images.`);
    results.push({ preset: preset.id, output: result.output, duration: metadata.duration, sha256: createHash("sha256").update(await (await import("node:fs/promises")).readFile(result.output)).digest("hex") });
  }
  if (new Set(results.map((result) => result.sha256)).size !== PRESETS.length) throw new Error("One or more preset exports were byte-identical.");
  console.log(JSON.stringify(results, null, 2));
}

void main();
