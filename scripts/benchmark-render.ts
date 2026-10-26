import "./isolated-data";
import { execFile } from "node:child_process";
import { mkdir, writeFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createSessionId, ensureSession } from "../src/lib/storage/session-storage";
import { ffmpeg, runProcess } from "../src/lib/video/process";
import { createMezzanine } from "../src/lib/video/mezzanine";
import { analyzeShot } from "../src/lib/video/shot-analysis";
import { probeVideo } from "../src/lib/video/metadata";
import { writeJson } from "../src/lib/server/store";
import { renderReel } from "../src/lib/video/render";
import { createJob, getJob } from "../src/lib/jobs/queue";
import { defaultCreativeOptions, type CreativeOptions } from "../src/lib/creative/options";
import { getPreset } from "../src/lib/presets";
import { planCreative } from "../src/lib/ai/creative-planner";
import { fixtureClip } from "./fixtures";

/**
 * Real measurements on this machine. Network upload is excluded (server-side processing only). Every number
 * comes from a completed, probed MP4; failures are recorded rather than hidden.
 */
const run = promisify(execFile);
type Row = Record<string, string | number | boolean | undefined>;
const rows: Row[] = [];

/** Peak resident memory of FFmpeg processes while `task` runs (Windows tasklist / POSIX ps). */
async function withPeakMemory<T>(task: () => Promise<T>): Promise<{ value: T; peakMb?: number }> {
  let peak = 0, sampling = true;
  const sample = async () => {
    try {
      if (process.platform === "win32") {
        const { stdout } = await run("tasklist", ["/FI", "IMAGENAME eq ffmpeg.exe", "/FO", "CSV", "/NH"], { windowsHide: true });
        const total = [...stdout.matchAll(/"([\d,.\s]+) K"/g)].reduce((sum, match) => sum + Number(match[1].replace(/[^\d]/g, "")), 0);
        peak = Math.max(peak, total / 1024);
      } else { const { stdout } = await run("ps", ["-C", "ffmpeg", "-o", "rss="]); peak = Math.max(peak, stdout.split("\n").reduce((sum, line) => sum + (Number(line) || 0), 0) / 1024); }
    } catch { /* no ffmpeg running at this instant */ }
  };
  const loop = (async () => { while (sampling) { await sample(); await new Promise((resolve) => setTimeout(resolve, 150)); } })();
  try { const value = await task(); return { value, peakMb: peak ? Math.round(peak) : undefined }; } finally { sampling = false; await loop; }
}

async function session(totalSeconds: number) {
  const sessionId = createSessionId(), directory = await ensureSession(sessionId);
  const per = totalSeconds / 3;
  const uploadMs: number[] = [];
  let real = true;
  for (let index = 0; index < 3; index++) {
    const clip = await fixtureClip("portrait", index, 7);
    real &&= clip.real;
    const trimmed = path.join(directory, `raw-${index}.mp4`), target = path.join(directory, `shot-${index + 1}.mp4`);
    await runProcess(ffmpeg(), ["-y", "-v", "error", "-stream_loop", "3", "-i", clip.file, "-t", per.toFixed(2), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", trimmed], "Benchmark input");
    const started = Date.now();
    await createMezzanine(trimmed, target, per + 1);
    await writeJson(path.join(directory, `shot-${index + 1}-analysis.json`), await analyzeShot(target, await probeVideo(target)));
    uploadMs.push(Date.now() - started);
  }
  return { sessionId, directory, real, uploadProcessingMs: Math.round(uploadMs.reduce((a, b) => a + b, 0)) };
}

async function renderCase(label: string, sessionId: string, inputSeconds: number, presetId: string, options: Partial<CreativeOptions>, extra: Row = {}) {
  const started = Date.now();
  try {
    const { value: result, peakMb } = await withPeakMemory(() => renderReel({ sessionId, presetId, outputName: `bench-${rows.length}.mp4`, ...options }));
    const metadata = await probeVideo(result.output);
    rows.push({ case: label, inputSeconds, preset: presetId, profile: options.profile || "fast", planMs: result.timings.planMs, renderMs: result.timings.renderMs, totalMs: Date.now() - started, outputSeconds: Number(metadata.duration.toFixed(2)), resolution: `${metadata.width}x${metadata.height}`, codec: metadata.codecName, sizeMB: Number(((await stat(result.output)).size / 1048576).toFixed(2)), peakFfmpegMB: peakMb, result: "ok", ...extra });
    return result.output;
  } catch (error) {
    rows.push({ case: label, inputSeconds, preset: presetId, profile: options.profile || "fast", totalMs: Date.now() - started, result: `failed: ${(error as Error).message.slice(0, 120)}`, ...extra });
    return undefined;
  }
}

async function main() {
  const out = path.join(process.cwd(), "data", "benchmarks"); await mkdir(out, { recursive: true });
  const machine = { cpu: os.cpus()[0]?.model, logicalCores: os.cpus().length, totalMemoryGB: Number((os.totalmem() / 1024 ** 3).toFixed(1)), freeMemoryGB: Number((os.freemem() / 1024 ** 3).toFixed(1)), platform: `${os.platform()} ${os.release()}`, node: process.version, ffmpeg: (await runProcess(ffmpeg(), ["-version"], "FFmpeg version")).split("\n")[0] };
  const ten = await session(10), twenty = await session(20);
  const preset = getPreset("movie-trailer")!;

  // Cold: the very first render in this process (font cache, libass and codec initialisation included).
  await renderCase("cold first render", ten.sessionId, 10, "main-character", { audioMode: "original" }, { phase: "cold" });
  for (const [inputs, label] of [[ten, 10], [twenty, 20]] as const) for (const presetId of ["main-character", "beat-sync", "movie-trailer"]) for (const profile of ["fast", "quality"] as const) {
    await renderCase("warm render", inputs.sessionId, label, presetId, { audioMode: "original", profile }, { phase: "warm" });
  }
  await renderCase("soundtrack mix + speech-safe ducking", ten.sessionId, 10, "squad-montage", { audioMode: "mix", musicId: "pulse" }, { phase: "warm" });

  // Thread scaling for the fast profile.
  for (const threads of [2, 4, 8]) { process.env.RENDER_THREADS = String(threads); await renderCase(`threads=${threads}`, ten.sessionId, 10, "movie-trailer", { audioMode: "original" }, { phase: "warm", threads }); }
  delete process.env.RENDER_THREADS;

  // Hardware encoder: speed AND correctness against the libx264 reference (SSIM), never assumed from a listing.
  const reference = await renderCase("encoder libx264 (reference)", ten.sessionId, 10, "movie-trailer", { audioMode: "original" }, { phase: "warm", encoder: "libx264" });
  process.env.RENDER_ENCODER = "h264_amf";
  const amf = await renderCase("encoder h264_amf", ten.sessionId, 10, "movie-trailer", { audioMode: "original" }, { phase: "warm", encoder: "h264_amf" });
  delete process.env.RENDER_ENCODER;
  let amfSsim: number | undefined;
  if (reference && amf) {
    const log = await runProcess(ffmpeg(), ["-v", "info", "-i", amf, "-i", reference, "-lavfi", "ssim=stats_file=-", "-f", "null", "-"], "SSIM").catch(() => "");
    const values = [...log.matchAll(/All:([0-9.]+)/g)].map((match) => Number(match[1]));
    amfSsim = values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(4)) : undefined;
  }

  // Planning: local Qwen versus the rules fallback, as the visitor would experience it.
  const planStarted = Date.now();
  const plan = await planCreative(preset, "dramatic", [undefined, undefined, undefined]);
  const planning = { source: plan.source, wallMs: Date.now() - planStarted, modelLatencyMs: plan.latencyMs, fallbackReason: plan.fallbackReason };

  // End to end through the real queue: Generate pressed -> verified, downloadable MP4.
  const jobs: Row[] = [];
  for (const profile of ["fast", "quality"] as const) {
    const creative = { ...defaultCreativeOptions(preset), audioMode: "original" as const, profile };
    const created = await createJob({ sessionId: twenty.sessionId, presetId: preset.id, creative, consent: { publicDisplay: false, promoReuse: false } });
    let job = await getJob(created.id);
    while (job && !["completed", "failed"].includes(job.stage)) { await new Promise((resolve) => setTimeout(resolve, 200)); job = await getJob(created.id); }
    jobs.push({ profile, stage: job?.stage, generateToDownloadableMs: job?.metrics.totalMs, queueWaitMs: job?.metrics.queueWaitMs, planMs: job?.metrics.planMs, encodeMs: job?.metrics.encodeMs, verifyMs: job?.metrics.verifyMs, resolution: `${job?.metrics.width}x${job?.metrics.height}` });
  }

  const report = { measuredAt: new Date().toISOString(), machine, realFootage: ten.real, uploadProcessingMs: { inputs10s: ten.uploadProcessingMs, inputs20s: twenty.uploadProcessingMs }, renders: rows, encoder: { h264_amfSsimVsLibx264: amfSsim }, planning, endToEnd: jobs };
  const file = path.join(out, `benchmark-${report.measuredAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(file, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`Saved ${file}`);
}
void main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
