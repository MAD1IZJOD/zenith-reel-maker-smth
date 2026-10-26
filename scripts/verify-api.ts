import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { probeVideo } from "../src/lib/video/metadata";
import { sessionDirectory } from "../src/lib/storage/session-storage";

const port = 3101;
const baseUrl = `http://127.0.0.1:${port}`;
const log: string[] = [];
const server = spawn(process.execPath, [path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next"), "dev", "-p", String(port)], {
  cwd: process.cwd(),
  windowsHide: true,
  env: { ...process.env, NEXT_DIST_DIR: ".next-api-test", MAX_UPLOAD_MB: "1" },
});
server.stdout.on("data", (chunk) => log.push(chunk.toString()));
server.stderr.on("data", (chunk) => log.push(chunk.toString()));

async function waitForHealth(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`API test server did not start.\n${log.join("").slice(-2000)}`);
}

async function expectStatus(response: Response, expected: number, label: string): Promise<void> {
  if (response.status !== expected) throw new Error(`${label}: expected ${expected}, received ${response.status}: ${await response.text()}`);
}

async function upload(sessionId: string, shot: number, contents: BlobPart, type = "video/mp4"): Promise<Response> {
  const form = new FormData();
  form.set("sessionId", sessionId);
  form.set("shot", String(shot));
  form.set("file", new Blob([contents], { type }), `shot-${shot}.mp4`);
  return fetch(`${baseUrl}/api/uploads`, { method: "POST", body: form });
}

async function waitForJob(id: string): Promise<{ outputUrl: string; coverUrl: string }> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const response = await fetch(`${baseUrl}/api/jobs?id=${id}`);
    await expectStatus(response, 200, "job status");
    const { job } = await response.json() as { job: { stage: string; error?: string; outputUrl?: string; coverUrl?: string } };
    if (job.stage === "completed" && job.outputUrl && job.coverUrl) return { outputUrl: job.outputUrl, coverUrl: job.coverUrl };
    if (job.stage === "failed") throw new Error(`API render failed: ${job.error}`);
  }
  throw new Error("API render did not complete before the test timeout.");
}

async function createJob(sessionId: string, presetId: string, title: string): Promise<{ id: string }> {
  const response = await fetch(`${baseUrl}/api/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, presetId, title }) });
  await expectStatus(response, 200, "job creation");
  return (await response.json() as { job: { id: string } }).job;
}

async function main() {
  try {
    await waitForHealth();
    const invalidSession = randomUUID();
    await expectStatus(await upload(invalidSession, 1, "not a video", "text/plain"), 400, "invalid MIME validation");
    await expectStatus(await upload(invalidSession, 1, new Uint8Array(0)), 400, "empty file validation");
    await expectStatus(await upload(invalidSession, 1, new Uint8Array(1_048_577)), 400, "oversized file validation");
    await expectStatus(await upload(invalidSession, 1, "corrupt bytes"), 400, "corrupt file validation");

    const sessionId = randomUUID();
    const firstClip = await readFile(path.join(process.cwd(), "public", "samples", "shot-1.mp4"));
    await expectStatus(await upload(sessionId, 1, firstClip), 200, "valid first upload");
    const incomplete = await fetch(`${baseUrl}/api/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, presetId: "retro-cam" }) });
    await expectStatus(incomplete, 400, "incomplete session validation");
    for (let shot = 2; shot <= 3; shot += 1) await expectStatus(await upload(sessionId, shot, await readFile(path.join(process.cwd(), "public", "samples", `shot-${shot}.mp4`))), 200, `valid upload ${shot}`);

    const firstJob = await createJob(sessionId, "retro-cam", "API lifecycle test");
    const firstOutput = await waitForJob(firstJob.id);
    const videoResponse = await fetch(`${baseUrl}${firstOutput.outputUrl}`);
    await expectStatus(videoResponse, 200, "output retrieval");
    if ((await videoResponse.arrayBuffer()).byteLength < 1_024) throw new Error("Retrieved export was unexpectedly small.");
    const asset = firstOutput.outputUrl.split("/").at(-1)!;
    const metadata = await probeVideo(path.join(sessionDirectory(sessionId), asset));
    if (metadata.codecName !== "h264" || metadata.width !== 720 || metadata.height !== 1280 || metadata.duration <= 0) throw new Error(`Unexpected API export metadata: ${JSON.stringify(metadata)}`);
    await expectStatus(await fetch(`${baseUrl}/api/reels/${randomUUID()}/${asset}`), 404, "unguessable-session protection");

    const secondJob = await createJob(sessionId, "movie-trailer", "API regenerated test");
    const secondOutput = await waitForJob(secondJob.id);
    if (firstOutput.outputUrl === secondOutput.outputUrl) throw new Error("Regeneration reused the previous output path.");
    console.log(JSON.stringify({ sessionId, firstOutput, secondOutput, metadata }, null, 2));
  } finally {
    server.kill();
  }
}

void main();
