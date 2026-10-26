import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { limit } from "@/lib/server/config";
import { parseCreativeOptions, type CreativeOptions } from "@/lib/creative/options";
import { getPreset, type ReelPreset } from "@/lib/presets";
import { ensureSession } from "@/lib/storage/session-storage";
import { readJson } from "@/lib/server/store";
import { probeVideo } from "./metadata";
import { ffmpeg, runProcess } from "./process";
import { getSoundtrack } from "@/lib/creative/music";
import { planClipEdit, type PlannerClip } from "@/lib/edit/planner";
import { edlDuration, type EditDecisionList } from "@/lib/edit/edl";
import { buildAss } from "./ass";
import { compileEdl } from "./compile";
import type { ShotAnalysis } from "./shot-analysis-types";
import type { TimedWord } from "@/lib/captions/grouping";

export const fontsDirectory = () => path.join(process.cwd(), "public", "fonts");
export const renderEncoder = () => (process.env.RENDER_ENCODER === "h264_amf" ? "h264_amf" as const : "libx264" as const);
/**
 * Encoder threads. Measured on a 16-thread Ryzen AI 7 laptop: 8 threads rendered a fast reel in 2.7 s versus
 * 3.8 s with 4. Cores are shared across concurrent renders and capped, leaving headroom for the web server.
 */
export const renderThreads = () => {
  const value = Number(process.env.RENDER_THREADS);
  if (Number.isInteger(value) && value > 0 && value <= 16) return value;
  const concurrent = limit("MAX_CONCURRENT_RENDERS", 1, 4);
  return Math.max(2, Math.min(8, Math.floor(os.cpus().length / (2 * concurrent))));
};

export type RenderStage = "preparing" | "rendering" | "finalizing";
export type RenderRequest = Partial<CreativeOptions> & {
  sessionId: string;
  presetId: string;
  title?: string;
  outputName?: string;
  sourceDirectory?: string;
  /** Source-time word timestamps per recorded shot, only from a real transcription. */
  transcripts?: (TimedWord[] | undefined)[];
  onStage?: (stage: RenderStage) => Promise<void>;
};
export type RenderResult = { output: string; cover: string; covers: string[]; preset: ReelPreset; edl: EditDecisionList; timings: { planMs: number; renderMs: number } };

/** Reuses metadata measured at upload; probes only when an older session has no saved analysis. */
export async function loadClips(directory: string): Promise<PlannerClip[]> {
  return Promise.all([1, 2, 3].map(async (shot) => {
    const file = path.join(directory, `shot-${shot}.mp4`);
    const analysis = await readJson<ShotAnalysis>(path.join(directory, `shot-${shot}-analysis.json`)).catch(() => undefined);
    if (analysis && analysis.width && analysis.height && analysis.duration) {
      // Saved analyses describe the source before upload normalization, so dimensions are confirmed cheaply here.
      const metadata = analysis.activity ? undefined : await probeVideo(file);
      return { duration: metadata?.duration ?? analysis.duration, width: metadata?.width ?? analysis.width, height: metadata?.height ?? analysis.height, hasAudio: metadata?.hasAudio ?? analysis.hasAudio, activity: analysis.activity };
    }
    const metadata = await probeVideo(file);
    return { duration: metadata.duration, width: metadata.width, height: metadata.height, hasAudio: metadata.hasAudio };
  }));
}

/** Writes the libass documents and runs the single FFmpeg pass that produces the MP4 and three covers. */
export async function executeEdl(edl: EditDecisionList, files: { sourcePaths: string[]; output: string; workDirectory: string; coverPrefix: string }): Promise<string[]> {
  await mkdir(files.workDirectory, { recursive: true });
  const videoAss = path.join(files.workDirectory, "video.ass"), coverAss = path.join(files.workDirectory, "cover.ass");
  await Promise.all([writeFile(videoAss, buildAss(edl, "video"), "utf8"), writeFile(coverAss, buildAss(edl, "cover"), "utf8")]);
  const track = edl.audio.musicId ? getSoundtrack(edl.audio.musicId) : undefined;
  const coverPattern = `${files.coverPrefix}-%d.jpg`;
  const args = compileEdl(edl, { sourcePaths: files.sourcePaths, musicPath: track ? path.join(process.cwd(), "public", track.url) : undefined, fontsDir: fontsDirectory(), videoAss, coverAss, output: files.output, coverPattern, encoder: renderEncoder(), threads: renderThreads() });
  const seconds = edlDuration(edl);
  const timeout = edl.profile === "quality" ? 120_000 + seconds * 15_000 : 60_000 + seconds * 6_000;
  await runProcess(ffmpeg(), args, "FFmpeg render", timeout);
  return [1, 2, 3].map((index) => `${files.coverPrefix}-${index}.jpg`);
}

export async function renderReel(request: RenderRequest): Promise<RenderResult> {
  const preset = getPreset(request.presetId);
  if (!preset) throw new Error("Choose a valid reel preset.");
  const directory = await ensureSession(request.sessionId);
  const sourceDirectory = request.sourceDirectory || directory;
  const output = path.join(directory, request.outputName || "reel.mp4");
  const baseName = path.basename(output, ".mp4");
  const workDirectory = path.join(sourceDirectory, `work-${baseName}`);
  await request.onStage?.("preparing");
  const planStarted = Date.now();
  const options = parseCreativeOptions(request, preset);
  const clips = await loadClips(sourceDirectory);
  const edl = planClipEdit({ preset, options, title: request.title, clips, transcripts: request.transcripts });
  const planMs = Date.now() - planStarted;
  await request.onStage?.("rendering");
  const renderStarted = Date.now();
  try {
    const covers = await executeEdl(edl, { sourcePaths: [1, 2, 3].map((shot) => path.join(sourceDirectory, `shot-${shot}.mp4`)), output, workDirectory, coverPrefix: path.join(directory, `cover-${baseName}`) });
    await request.onStage?.("finalizing");
    // The serialized plan makes every export reproducible and debuggable.
    await writeFile(path.join(directory, `edl-${baseName}.json`), JSON.stringify(edl), "utf8");
    return { output, cover: covers[edl.cover.selected], covers, preset, edl, timings: { planMs, renderMs: Date.now() - renderStarted } };
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}

