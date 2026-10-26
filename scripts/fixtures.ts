import { access, copyFile } from "node:fs/promises";
import path from "node:path";
import { createSessionId, ensureSession } from "../src/lib/storage/session-storage";
import { ffmpeg, runProcess } from "../src/lib/video/process";
import { createMezzanine } from "../src/lib/video/mezzanine";
import { analyzeShot } from "../src/lib/video/shot-analysis";
import { probeVideo } from "../src/lib/video/metadata";
import { writeJson } from "../src/lib/server/store";

export type FixtureKind = "portrait" | "landscape";
const fixtures = path.join(process.cwd(), "data", "fixtures");
const exists = (file: string) => access(file).then(() => true, () => false);
const NAMES = ["walk", "closeup", "group"];

/**
 * Real-footage fixtures come from `npm run fixtures:fetch` (Tears of Steel, CC-BY 3.0, Blender Foundation).
 * Without them, camera-like synthetic clips are generated so verification still runs offline.
 */
export async function fixtureClip(kind: FixtureKind, index: number, seconds = 7): Promise<{ file: string; real: boolean }> {
  const real = path.join(fixtures, `tos-${NAMES[index]}-${kind}.mp4`);
  if (await exists(real)) return { file: real, real: true };
  const synthetic = path.join(fixtures, `synthetic-${index}-${kind}-${seconds}.mp4`);
  if (!(await exists(synthetic))) {
    const size = kind === "portrait" ? "1080x1920" : "1920x1080";
    const hue = [20, 140, 260][index];
    await runProcess(ffmpeg(), ["-y", "-v", "error", "-f", "lavfi", "-i", `gradients=s=${size}:speed=0.03:n=4:seed=${index + 3}:duration=${seconds}:rate=30`,
      "-f", "lavfi", "-i", `sine=frequency=${220 + index * 110}:sample_rate=48000:duration=${seconds}`,
      "-vf", `hue=h=${hue},drawbox=x='iw*0.3+iw*0.2*sin(t*${1 + index})':y=ih*0.35:w=iw*0.25:h=ih*0.2:color=white@0.85:t=fill,noise=alls=8:allf=t`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", synthetic], "Synthetic fixture", 120_000);
  }
  return { file: synthetic, real: false };
}

/** A session prepared exactly like real uploads: mezzanine normalization plus saved shot analysis. */
export async function prepareFixtureSession(kind: FixtureKind, seconds = 7): Promise<{ sessionId: string; directory: string; real: boolean }> {
  const sessionId = createSessionId(), directory = await ensureSession(sessionId);
  let real = true;
  for (let index = 0; index < 3; index++) {
    const clip = await fixtureClip(kind, index, seconds);
    real &&= clip.real;
    const target = path.join(directory, `shot-${index + 1}.mp4`);
    await createMezzanine(clip.file, target, seconds + 1);
    await writeJson(path.join(directory, `shot-${index + 1}-analysis.json`), await analyzeShot(target, await probeVideo(target)));
  }
  return { sessionId, directory, real };
}

export async function copySamples(directory: string) {
  await Promise.all([1, 2, 3].map((shot) => copyFile(path.join(process.cwd(), "public", "samples", `shot-${shot}.mp4`), path.join(directory, `shot-${shot}.mp4`))));
}
