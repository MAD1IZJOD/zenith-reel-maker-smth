import path from "node:path";
import { readJson, writeJson } from "@/lib/server/store";
import { ffmpeg, runProcess } from "@/lib/video/process";
import { MEDIA_INPUT_OPTIONS } from "@/lib/video/input-policy";

export type AudioProfile = { step: number; rms: number[] };
const STEP = 0.5;

/** Speech loudness every half second for the whole source, measured once and cached beside the source. */
export async function audioProfile(sourceDirectory: string, media: string): Promise<AudioProfile | undefined> {
  const cache = path.join(sourceDirectory, "audio-profile.json");
  const cached = await readJson<AudioProfile>(cache).catch(() => undefined);
  if (cached?.rms?.length) return cached;
  try {
    const output = await runProcess(ffmpeg(), ["-v", "error", ...MEDIA_INPUT_OPTIONS, "-i", media, "-vn", "-af", `aresample=16000,asetnsamples=n=${16000 * STEP}:p=0,astats=metadata=1:reset=1:measure_overall=RMS_level:measure_perchannel=none,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=-`, "-f", "null", "-"], "Audio profile", 300_000);
    const rms = [...output.matchAll(/RMS_level=(-?[0-9.]+|-?inf)/g)].map((match) => (match[1].endsWith("inf") ? -90 : Math.max(-90, Math.round(Number(match[1]) * 10) / 10)));
    const profile = { step: STEP, rms };
    await writeJson(cache, profile);
    return profile;
  } catch { return undefined; }
}
