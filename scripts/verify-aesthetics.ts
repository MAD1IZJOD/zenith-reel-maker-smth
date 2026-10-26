import "./isolated-data";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PRESETS } from "../src/lib/presets";
import { renderReel } from "../src/lib/video/render";
import { ffmpeg, ffprobe, runProcess } from "../src/lib/video/process";
import { edlDuration, type EditDecisionList } from "../src/lib/edit/edl";
import { prepareFixtureSession, type FixtureKind } from "./fixtures";
import type { CreativeOptions } from "../src/lib/creative/options";

/**
 * Renders fixed footage through every style and measures what can be measured objectively: no unintended black
 * frames, exact 9:16 geometry with square pixels, 30fps, expected duration, audible sound when requested, and a
 * non-blank ending. Contact sheets are written for the human judgement no automated check can replace.
 */
const out = path.join(process.cwd(), "data", "aesthetics", new Date().toISOString().replace(/[:.]/g, "-"));
const lines = (text: string, key: string) => [...text.matchAll(new RegExp(`${key.replace(/\./g, "\\.")}=(-?[0-9.]+|-?inf)`, "g"))].map((match) => (match[1].endsWith("inf") ? -120 : Number(match[1])));

export async function inspectExport(file: string, edl: EditDecisionList) {
  const probe = JSON.parse(await runProcess(ffprobe(), ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,sample_aspect_ratio,r_frame_rate:format=duration", "-of", "json", file], "Export probe")) as { streams: { codec_type: string; codec_name: string; width?: number; height?: number; sample_aspect_ratio?: string; r_frame_rate?: string }[]; format: { duration: string } };
  const video = probe.streams.find((stream) => stream.codec_type === "video")!, audio = probe.streams.find((stream) => stream.codec_type === "audio");
  const black = await runProcess(ffmpeg(), ["-v", "error", "-i", file, "-an", "-vf", "blackdetect=d=0.08:pix_th=0.08,metadata=mode=print:key=lavfi.black_start:file=-", "-f", "null", "-"], "Black frame scan");
  const ending = lines(await runProcess(ffmpeg(), ["-v", "error", "-sseof", "-0.25", "-i", file, "-an", "-frames:v", "1", "-vf", "signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"], "Ending scan"), "lavfi.signalstats.YAVG")[0];
  const rms = audio ? lines(await runProcess(ffmpeg(), ["-v", "error", "-i", file, "-vn", "-af", "astats=metadata=1:reset=0:measure_perchannel=none,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=-", "-f", "null", "-"], "Audio level scan"), "lavfi.astats.Overall.RMS_level").at(-1) : undefined;
  const result = {
    codec: video.codec_name, width: video.width, height: video.height, sar: video.sample_aspect_ratio, fps: video.r_frame_rate, audio: audio?.codec_name,
    duration: Number(probe.format.duration), expected: edlDuration(edl), blackIntervals: lines(black, "lavfi.black_start").length, endingLuma: ending, audioRmsDb: rms,
  };
  assert.equal(result.codec, "h264"); assert.equal(result.width, edl.canvas.width); assert.equal(result.height, edl.canvas.height);
  assert.ok(!result.sar || result.sar === "1:1", `pixel aspect ${result.sar}`); assert.equal(result.fps, "30/1"); assert.equal(result.audio, "aac");
  assert.ok(Math.abs(result.duration - result.expected) < 0.15, `duration ${result.duration} vs ${result.expected}`);
  assert.equal(result.blackIntervals, 0, "unexpected black frames");
  assert.ok(result.endingLuma > 20, `blank ending (luma ${result.endingLuma})`);
  if (edl.audio.mode !== "muted") assert.ok((rms ?? -120) > -45, `requested audio is silent (${rms} dB)`);
  return result;
}

async function sheet(file: string, duration: number, target: string) {
  await runProcess(ffmpeg(), ["-y", "-v", "error", "-i", file, "-vf", `fps=${(8 / duration).toFixed(4)},scale=180:-2,tile=8x1`, "-frames:v", "1", target], "Contact sheet");
}

async function main() {
  await mkdir(out, { recursive: true });
  const report: Record<string, unknown>[] = [];
  const cases: { kind: FixtureKind; presetId: string; options: Partial<CreativeOptions> }[] = [];
  for (const kind of ["portrait", "landscape"] as const) for (const preset of PRESETS) cases.push({ kind, presetId: preset.id, options: { audioMode: "original" } });
  cases.push({ kind: "portrait", presetId: "beat-sync", options: { audioMode: "soundtrack", syncMode: "auto" } });
  cases.push({ kind: "landscape", presetId: "squad-montage", options: { audioMode: "mix", musicId: "drift" } });
  cases.push({ kind: "portrait", presetId: "main-character", options: { audioMode: "original", profile: "quality" } });
  cases.push({ kind: "landscape", presetId: "movie-trailer", options: { audioMode: "muted", profile: "quality" } });
  const sessions = new Map<FixtureKind, Awaited<ReturnType<typeof prepareFixtureSession>>>();
  for (const [index, item] of cases.entries()) {
    if (!sessions.has(item.kind)) sessions.set(item.kind, await prepareFixtureSession(item.kind));
    const session = sessions.get(item.kind)!;
    const name = `${String(index + 1).padStart(2, "0")}-${item.kind}-${item.presetId}-${item.options.profile || "fast"}-${item.options.audioMode}`;
    const started = Date.now();
    const result = await renderReel({ sessionId: session.sessionId, presetId: item.presetId, outputName: `${name}.mp4`, ...item.options });
    const ms = Date.now() - started;
    const inspection = await inspectExport(result.output, result.edl);
    await sheet(result.output, inspection.duration, path.join(out, `${name}.jpg`));
    report.push({ name, realFootage: session.real, renderMs: ms, grade: result.edl.grade, transitions: result.edl.transitions.map((t) => t.type), ...inspection, output: result.output });
    console.log(`${name}: ${ms} ms, ${inspection.duration.toFixed(2)}s, black=${inspection.blackIntervals}, ending=${inspection.endingLuma}, audio=${inspection.audioRmsDb?.toFixed(1)}dB`);
  }
  await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(`All ${report.length} exports passed objective checks. Contact sheets for visual review: ${out}`);
}
if (process.argv[1]?.includes("verify-aesthetics")) void main().catch((error) => { console.error(error); process.exitCode = 1; });
