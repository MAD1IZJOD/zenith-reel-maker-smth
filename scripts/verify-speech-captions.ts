import "./isolated-data";
import assert from "node:assert/strict";
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createSessionId, ensureSession } from "../src/lib/storage/session-storage";
import { createJob, getJob } from "../src/lib/jobs/queue";
import { defaultCreativeOptions } from "../src/lib/creative/options";
import { getPreset } from "../src/lib/presets";
import { ffmpeg, runProcess } from "../src/lib/video/process";
import { createMezzanine } from "../src/lib/video/mezzanine";
import { analyzeShot } from "../src/lib/video/shot-analysis";
import { probeVideo } from "../src/lib/video/metadata";
import { writeJson } from "../src/lib/server/store";
import type { EditDecisionList } from "../src/lib/edit/edl";

/** Clip-mode speech captions through the real queue: three spoken shots, local transcription, karaoke captions. */
async function main() {
  const fixture = path.join(process.cwd(), "data", "fixtures", "tos-dialogue.mp4");
  await access(fixture).catch(() => { throw new Error("Run `npm run fixtures:fetch` first."); });
  const sessionId = createSessionId(), directory = await ensureSession(sessionId);
  for (const [index, start] of [5, 12, 20].entries()) {
    const slice = path.join(directory, `slice-${index}.mp4`), target = path.join(directory, `shot-${index + 1}.mp4`);
    await runProcess(ffmpeg(), ["-y", "-v", "error", "-ss", String(start), "-t", "6.5", "-i", fixture, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", slice], "Speech slice");
    await createMezzanine(slice, target, 10);
    await writeJson(path.join(directory, `shot-${index + 1}-analysis.json`), await analyzeShot(target, await probeVideo(target)));
  }
  const preset = getPreset("main-character")!;
  const creative = { ...defaultCreativeOptions(preset), audioMode: "original" as const, captionMode: "speech" as const, captionStyle: "clean-creator" as const };
  const wait = async (id: string) => { for (;;) { const job = await getJob(id); if (job?.stage === "completed" || job?.stage === "failed") return job; await new Promise((resolve) => setTimeout(resolve, 400)); } };
  const first = await wait((await createJob({ sessionId, presetId: preset.id, creative, consent: { publicDisplay: false, promoReuse: false } })).id);
  assert.equal(first.stage, "completed", first.error);
  const second = await wait((await createJob({ sessionId, presetId: preset.id, creative: { ...creative, captionStyle: "podcast-pop" }, consent: { publicDisplay: false, promoReuse: false } })).id);
  assert.equal(second.stage, "completed", second.error);
  const edl = JSON.parse(await readFile(path.join(directory, `edl-reel-${first.id}.json`), "utf8")) as EditDecisionList;
  const words = edl.captions.flatMap((group) => group.words.map((word) => word.text));
  assert.ok(words.length >= 6, "speech captions present"); assert.ok(!edl.overlays.some((overlay) => overlay.role === "card"), "no title cards when speech captions exist");
  const out = path.join(process.cwd(), "data", "aesthetics", "speech-captions"); await mkdir(out, { recursive: true });
  await runProcess(ffmpeg(), ["-y", "-v", "error", "-i", path.join(directory, `reel-${first.id}.mp4`), "-vf", "fps=1,scale=200:-2,tile=8x1", "-frames:v", "1", path.join(out, "clean-creator.jpg")], "Speech caption sheet");
  console.log(JSON.stringify({ first: first.metrics, second: second.metrics, captionGroups: edl.captions.length, words }, null, 2));
}
void main().then(() => process.exit(0), (error) => { console.error(error.message || error); process.exit(1); });
