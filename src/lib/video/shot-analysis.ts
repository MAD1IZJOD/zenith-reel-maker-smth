import type { VideoMetadata } from "./metadata";
import type { ShotAnalysis, ShotIssue } from "./shot-analysis-types";
import { ffmpeg, runProcess } from "./process";

/** Explainable measurements, not a semantic model or an aesthetic score. */
export function assessShot(metadata: VideoMetadata, luminance: number[] = []): ShotAnalysis {
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
  return { supported: true, technicalValidity: "valid", duration: metadata.duration, width, height, orientation: width > height ? "landscape" : width < height ? "portrait" : "square", hasAudio: metadata.hasAudio, brightness, sampledFrames: luminance.length, issues };
}

/** Three small luminance samples within one second near the midpoint, before padding. */
export async function analyzeShot(file: string, metadata: VideoMetadata): Promise<ShotAnalysis> {
  let values: number[] = [];
  try {
    const output = await runProcess(ffmpeg(), ["-v", "error", "-threads", "1", "-ss", String(Math.max(0, metadata.duration / 2 - 0.4)), "-i", file, "-an", "-t", "1", "-vf", "fps=3,scale=160:-2,signalstats,metadata=mode=print:file=-", "-filter_threads", "1", "-frames:v", "3", "-f", "null", "-"], "Shot light analysis", 15_000);
    values = [...output.matchAll(/lavfi\.signalstats\.YAVG=([0-9.]+)/g)].map((match) => Number(match[1])).filter(Number.isFinite);
  } catch { /* A suggestion failure never invalidates footage that passed decode validation. */ }
  return assessShot(metadata, values);
}
