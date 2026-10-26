import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, copyFile } from "node:fs/promises";
import { createJob, getJob } from "@/lib/jobs/queue";
import { defaultCreativeOptions } from "@/lib/creative/options";
import { PRESETS } from "@/lib/presets";
import { createSessionId, ensureSession } from "@/lib/storage/session-storage";
import { probeVideo } from "@/lib/video/metadata";

test("remix retains source footage after replacements and produces independent real files", { timeout: 120_000 }, async () => {
  const sessionId = createSessionId(), directory = await ensureSession(sessionId);
  await Promise.all([1, 2, 3].map((i) => copyFile(path.resolve(`public/samples/shot-${i}.mp4`), path.join(directory, `shot-${i}.mp4`))));
  const input = { sessionId, presetId: PRESETS[0].id, creative: defaultCreativeOptions(PRESETS[0]), consent: { publicDisplay: false, promoReuse: false } };
  const wait = async (id: string) => { for (let attempt = 0; attempt < 250; attempt++) { const job = await getJob(id); if (job?.stage === "failed") throw new Error(job.error); if (job?.stage === "completed") return job; await new Promise((resolve) => setTimeout(resolve, 300)); } throw new Error("Render timed out"); };
  const original = await wait((await createJob(input)).id);
  const snapshot = await readFile(path.join(directory, `sources-${original.sourceId}`, "shot-1.mp4"));
  await copyFile(path.resolve("public/samples/shot-3.mp4"), path.join(directory, "shot-1.mp4"));
  const remix = await wait((await createJob({ ...input, sourceJobId: original.id, presetId: PRESETS[4].id, creative: defaultCreativeOptions(PRESETS[4]) })).id);
  assert.equal(original.sourceId, remix.sourceId); assert.notEqual(original.id, remix.id);
  assert.deepEqual(await readFile(path.join(directory, `sources-${remix.sourceId}`, "shot-1.mp4")), snapshot);
  assert.notDeepEqual(await readFile(path.join(directory, "shot-1.mp4")), snapshot);
  for (const job of [original, remix]) { const file = path.join(directory, `reel-${job.id}.mp4`); const meta = await probeVideo(file); assert.equal(meta.codecName, "h264"); assert.equal(meta.height, 1280); console.log(JSON.stringify({ job: job.id, source: job.sourceId, output: file, duration: meta.duration })); }
  await assert.rejects(createJob({ ...input, sessionId: createSessionId(), sourceJobId: original.id }), /unavailable in this session/);
});
