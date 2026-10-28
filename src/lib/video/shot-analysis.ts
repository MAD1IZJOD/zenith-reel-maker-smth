import type { VideoMetadata } from "./metadata";
import type { ShotActivity, ShotAnalysis, ShotIssue } from "./shot-analysis-types";
import { readFile, rm } from "node:fs/promises";
import { ffmpeg, runProcess } from "./process";
import { MEDIA_INPUT_OPTIONS } from "./input-policy";
import { filterPath } from "./compile";

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
 * One decode pass (one FFmpeg process, keeping upload work bounded) measures per-0.2 s luma and frame
 * difference plus audio RMS. Light uses the samples nearest the clip's middle; motion and audio feed
 * automatic trimming. Failures never invalidate footage that already passed decode validation.
 */
export async function analyzeShot(file: string, metadata: VideoMetadata): Promise<ShotAnalysis> {
  const videoLog = `${file}.video-stats.txt`, audioLog = `${file}.audio-stats.txt`;
  const graph = [`[0:v]fps=${1 / ACTIVITY_STEP},scale=96:-2,signalstats,metadata=mode=print:file='${filterPath(videoLog)}'[v]`];
  if (metadata.hasAudio) graph.push(`[0:a]aresample=48000,asetnsamples=n=${48000 * ACTIVITY_STEP}:p=0,astats=metadata=1:reset=1:measure_overall=RMS_level:measure_perchannel=none,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file='${filterPath(audioLog)}'[a]`);
  try {
    await runProcess(ffmpeg(), ["-v", "error", "-threads", "1", ...MEDIA_INPUT_OPTIONS, "-i", file, "-filter_complex", graph.join(";"), "-filter_complex_threads", "1", "-map", "[v]", "-f", "null", "-", ...(metadata.hasAudio ? ["-map", "[a]", "-f", "null", "-"] : [])], "Shot analysis", 60_000);
    const video = await readFile(videoLog, "utf8");
    const luma = values(video, "lavfi.signalstats.YAVG");
    const middle = Math.round(metadata.duration / 2 / ACTIVITY_STEP);
    const light = luma.slice(Math.max(0, middle - 2), middle + 3);
    const motion = values(video, "lavfi.signalstats.YDIF").map((value) => Math.round(value * 100) / 100);
    const audio = metadata.hasAudio ? values(await readFile(audioLog, "utf8").catch(() => ""), "lavfi.astats.Overall.RMS_level").map((value) => Math.max(-90, Math.round(value * 10) / 10)) : [];
    return assessShot(metadata, light, motion.length ? { step: ACTIVITY_STEP, motion, audio } : undefined);
  } catch { return assessShot(metadata); }
  finally { await Promise.all([rm(videoLog, { force: true }), rm(audioLog, { force: true })]); }
}
