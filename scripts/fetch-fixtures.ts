import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ffmpeg, runProcess } from "../src/lib/video/process";

/**
 * Downloads short excerpts of "Tears of Steel" (c) Blender Foundation | mango.blender.org, licensed CC-BY 3.0,
 * for local visual QA and transcription tests. FFmpeg range-requests only the needed seconds. The excerpts stay
 * in ignored data/fixtures and are never committed or served.
 */
const SOURCE = "https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov";
const CLIPS = [["walk", 262, 7], ["closeup", 307, 6], ["group", 232, 7]] as const;

async function main() {
  const directory = path.join(process.cwd(), "data", "fixtures");
  await mkdir(directory, { recursive: true });
  for (const [name, start, seconds] of CLIPS) {
    const landscape = path.join(directory, `tos-${name}-landscape.mp4`);
    await runProcess(ffmpeg(), ["-y", "-v", "error", "-ss", String(start), "-t", String(seconds), "-i", SOURCE, "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-c:a", "aac", "-b:a", "160k", landscape], "Fixture download", 300_000);
    // A centre 9:16 crop simulates vertical phone footage.
    await runProcess(ffmpeg(), ["-y", "-v", "error", "-i", landscape, "-vf", "crop=ih*9/16:ih,scale=720:1280:flags=lanczos,setsar=1", "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-c:a", "copy", path.join(directory, `tos-${name}-portrait.mp4`)], "Portrait fixture", 120_000);
  }
  await runProcess(ffmpeg(), ["-y", "-v", "error", "-ss", "18", "-t", "62", "-i", SOURCE, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "160k", path.join(directory, "tos-dialogue.mp4")], "Dialogue fixture", 600_000);
  await writeFile(path.join(directory, "ATTRIBUTION.txt"), "Tears of Steel (c) Blender Foundation | mango.blender.org — Creative Commons Attribution 3.0. Local test excerpts only.\n");
  console.log(`Fixtures ready in ${directory}`);
}
void main().catch((error) => { console.error(error.message); process.exitCode = 1; });
