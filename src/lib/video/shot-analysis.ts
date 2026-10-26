import type { VideoMetadata } from "./metadata";
import type { ShotActivity, ShotAnalysis, ShotIssue } from "./shot-analysis-types";
import { ffmpeg, runProcess } from "./process";

export const ACTIVITY_STEP = 0.2;
const MAX_SAMPLES = 900;

/** Explainable measurements, not a semantic model or an aesthetic score. */
export function assessShot(metadata: VideoMetadata, luminance: number[] = [], activity?: ShotActivity): ShotAnalysis {
  const rotated = Math.abs(metadata.rotation || 0) % 180 === 90;
  const width = rotated ? metadata.height : metadata.width;
  const height = rotated ? metadata.width : metadata.height;
  const brightness = luminance.length ? Math.max(0, Math.min(1, (luminance.reduce((a, b) => a + b, 0) / luminance.length - 16) / 219)) : undefined;
  const issues: ShotIssue[] = [];
  if (metadata.duration < 2) issues.push("short");
  if (brightness !== undefined && brightness < 0.13) issues.push("dark");
  if (brightness !== undefined && brightness > 0.91) issues.push("bright");
  if (Math.min(width, height) < 480) issues.push("low-resolution");
  if (width > height) issues.push("landscape");
  return { supported: true, technicalValidity: "valid", duration: metadata.duration, width, height, orientation: width > height ? "landscape" : width < height ? "portrait" : "square", hasAudio: metadata.hasAudio, brightness, sampledFrames: luminance.length, issues, ...(activity ? { activity } : {}) };
}

const values = (output: string, key: string) => [...output.matchAll(new RegExp(`${key.replace(/\./g, "\\.")}=(-?[0-9.]+|-?inf)`, "g"))].map((match) => (match[1].endsWith("inf") ? -90 : Number(match[1]))).filter(Number.isFinite).slice(0, MAX_SAMPLES);

/**
 * Light from three frames near the middle, plus whole-clip motion (mean luma difference between 5 fps samples)
 * and audio RMS every 0.2s. These feed automatic trimming; failures never invalidate decodable footage.
 */
export async function analyzeShot(file: string, metadata: VideoMetadata): Promise<ShotAnalysis> {
  const [light, motion, audio] = await Promise.all([
    runProcess(ffmpeg(), ["-v", "error", "-threads", "1", "-ss", String(Math.max(0, metadata.duration / 2 - 0.4)), "-i", file, "-an", "-t", "1", "-vf", "fps=3,scale=160:-2,signalstats,metadata=mode=print:file=-", "-filter_threads", "1", "-frames:v", "3", "-f", "null", "-"], "Shot light analysis", 15_000).then((output) => values(output, "lavfi.signalstats.YAVG")).catch(() => [] as number[]),
    runProcess(ffmpeg(), ["-v", "error", "-threads", "1", "-i", file, "-an", "-vf", `fps=${1 / ACTIVITY_STEP},scale=96:-2,signalstats,metadata=mode=print:key=lavfi.signalstats.YDIF:file=-`, "-filter_threads", "1", "-f", "null", "-"], "Shot motion analysis", 60_000).then((output) => values(output, "lavfi.signalstats.YDIF")).catch(() => undefined),
    metadata.hasAudio
      ? runProcess(ffmpeg(), ["-v", "error", "-i", file, "-vn", "-af", `aresample=48000,asetnsamples=n=${48000 * ACTIVITY_STEP}:p=0,astats=metadata=1:reset=1:measure_overall=RMS_level:measure_perchannel=none,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=-`, "-f", "null", "-"], "Shot audio analysis", 60_000).then((output) => values(output, "lavfi.astats.Overall.RMS_level").map((value) => Math.max(-90, Math.round(value * 10) / 10))).catch(() => [] as number[])
      : Promise.resolve([] as number[]),
  ]);
  const activity = motion && motion.length ? { step: ACTIVITY_STEP, motion: motion.map((value) => Math.round(value * 100) / 100), audio } : undefined;
  return assessShot(metadata, light, activity);
}
