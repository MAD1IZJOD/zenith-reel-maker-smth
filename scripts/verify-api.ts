import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { probeVideo } from "../src/lib/video/metadata";
import { sessionDirectory } from "../src/lib/storage/session-storage";

const port = 3101;
const baseUrl = `http://127.0.0.1:${port}`;
const nextEnvPath = path.join(process.cwd(), "next-env.d.ts");
const log: string[] = [];
const cookies = new Map<string, string>();
const operatorTestSecret = randomUUID() + randomUUID();
const rawFetch = globalThis.fetch;
async function fetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers); headers.set("Cookie", [...cookies].map(([key, value]) => `${key}=${value}`).join("; "));
  const response = await rawFetch(input, { ...init, headers });
  for (const entry of response.headers.getSetCookie()) { const [pair] = entry.split(";"); const split = pair.indexOf("="); cookies.set(pair.slice(0, split), pair.slice(split + 1)); }
  return response;
}
async function newSession(): Promise<string> { const response = await fetch(`${baseUrl}/api/sessions`, { method: "POST" }); if (!response.ok) throw new Error("Session creation failed"); return (await response.json()).sessionId; }
function startServer(): ChildProcess {
  const child = spawn(process.execPath, [path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next"), "dev", "-p", String(port)], {
    cwd: process.cwd(),
    windowsHide: true,
    env: { ...process.env, NEXT_DIST_DIR: ".next-api-test", MAX_UPLOAD_MB: "1", MAX_CONCURRENT_RENDERS: "1", MAX_PENDING_RENDERS: "1", OPERATOR_SECRET: operatorTestSecret, ENABLE_LEADERBOARD: "true" },
  });
  child.stdout.on("data", (chunk) => log.push(chunk.toString()));
  child.stderr.on("data", (chunk) => log.push(chunk.toString()));
  return child;
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
}

let server = startServer();

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
  for (let retry = 0; retry < 30; retry++) {
    const response = await fetch(`${baseUrl}/api/uploads`, { method: "POST", body: form });
    if (response.status !== 429) return response;
    await response.text(); await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Upload admission did not recover");
}

async function waitForJob(id: string): Promise<{ outputUrl: string; coverUrl: string; coverUrls: string[] }> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const response = await fetch(`${baseUrl}/api/jobs?id=${id}`);
    await expectStatus(response, 200, "job status");
    const { job } = await response.json() as { job: { stage: string; error?: string; outputUrl?: string; coverUrl?: string; coverUrls?: string[] } };
    if (job.stage === "completed" && job.outputUrl && job.coverUrl && job.coverUrls?.length === 3) return { outputUrl: job.outputUrl, coverUrl: job.coverUrl, coverUrls: job.coverUrls };
    if (job.stage === "failed") throw new Error(`API render failed: ${job.error}`);
  }
  throw new Error("API render did not complete before the test timeout.");
}

async function createJob(sessionId: string, presetId: string, title: string, consent = { publicDisplay: false, promoReuse: false }): Promise<{ id: string }> {
  const creative = { vibe: "dramatic", hook: "API hook that renders", captions: ["FIRST", "SECOND", "THIRD"], captionStyle: "bold", shotOrder: [2, 0, 1], audioMode: "original" };
    const response = await fetch(`${baseUrl}/api/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, presetId, title, creative, consent, challengeId: "memories" }) });
  await expectStatus(response, 200, "job creation");
  return (await response.json() as { job: { id: string } }).job;
}

async function main() {
  const originalNextEnv = await readFile(nextEnvPath, "utf8");
  try {
    await waitForHealth();
    await expectStatus(await fetch(`${baseUrl}/api/jobs?id=not-a-job-id`), 404, "invalid job lookup");
    const invalidSession = await newSession();
    await expectStatus(await upload(invalidSession, 1, "not a video", "text/plain"), 400, "invalid MIME validation");
    await expectStatus(await upload(invalidSession, 1, new Uint8Array(0)), 400, "empty file validation");
    await expectStatus(await upload(invalidSession, 1, new Uint8Array(1_048_577)), 400, "oversized file validation");
    await expectStatus(await upload(invalidSession, 1, "corrupt bytes"), 400, "corrupt file validation");

    const sessionId = await newSession();
    const firstClip = await readFile(path.join(process.cwd(), "public", "samples", "shot-1.mp4"));
    await expectStatus(await upload(sessionId, 1, firstClip), 200, "valid first upload");
    const incomplete = await fetch(`${baseUrl}/api/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, presetId: "retro-cam" }) });
    await expectStatus(incomplete, 400, "incomplete session validation");
    await expectStatus(await fetch(`${baseUrl}/api/uploads?sessionId=${sessionId}&shot=1`, { method: "DELETE" }), 200, "shot replacement cleanup");
    const clearedSession = await fetch(`${baseUrl}/api/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, presetId: "retro-cam" }) });
    await expectStatus(clearedSession, 400, "cleared shot validation");
    await expectStatus(await upload(sessionId, 1, firstClip), 200, "re-upload after replacement");
    for (let shot = 2; shot <= 3; shot += 1) await expectStatus(await upload(sessionId, shot, await readFile(path.join(process.cwd(), "public", "samples", `shot-${shot}.mp4`))), 200, `valid upload ${shot}`);
    const draft = { presetId: "retro-cam", title: "Recovered draft", creative: { vibe: "nostalgic", hook: "Recovered hook", captions: ["A", "B", "C"], captionStyle: "retro", shotOrder: [1, 2, 0], audioMode: "muted" }, shots: [1, 2, 3].map((shot) => ({ previewUrl: `/api/reels/${sessionId}/shot-${shot}.mp4`, duration: 4, name: `shot-${shot}.mp4` })), activeShot: 2, screen: "review", advancedGuidance: true, renders: [], achievements: ["three-shot-finisher"], publicDisplay: false, promoReuse: false };
    const draftSave = await fetch(`${baseUrl}/api/sessions/${sessionId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
    await expectStatus(draftSave, 200, "session draft save");

    const firstJob = await createJob(sessionId, "retro-cam", "API lifecycle test", { publicDisplay: true, promoReuse: false });
    const firstOutput = await waitForJob(firstJob.id);
    const videoResponse = await fetch(`${baseUrl}${firstOutput.outputUrl}`);
    await expectStatus(videoResponse, 200, "output retrieval");
    if ((await videoResponse.arrayBuffer()).byteLength < 1_024) throw new Error("Retrieved export was unexpectedly small.");
    for (const coverUrl of firstOutput.coverUrls) {
      const coverResponse = await fetch(`${baseUrl}${coverUrl}`);
      await expectStatus(coverResponse, 200, "cover retrieval");
      if ((await coverResponse.arrayBuffer()).byteLength < 1_024) throw new Error("Retrieved cover was unexpectedly small.");
    }
    const asset = firstOutput.outputUrl.split("/").at(-1)!;
    const metadata = await probeVideo(path.join(sessionDirectory(sessionId), asset));
    if (metadata.codecName !== "h264" || metadata.width !== 720 || metadata.height !== 1280 || metadata.duration <= 0) throw new Error(`Unexpected API export metadata: ${JSON.stringify(metadata)}`);
    await expectStatus(await fetch(`${baseUrl}/api/reels/${randomUUID()}/${asset}`), 401, "unknown-session protection");
    await expectStatus(await rawFetch(`${baseUrl}${firstOutput.outputUrl}`), 401, "known session without cookie denied");
    await expectStatus(await rawFetch(`${baseUrl}/api/jobs?id=${firstJob.id}`), 401, "known job without cookie denied");
    const range = await fetch(`${baseUrl}${firstOutput.outputUrl}`, { headers: { Range: "bytes=0-99" } });
    await expectStatus(range, 206, "MP4 range playback");
    if ((await range.arrayBuffer()).byteLength !== 100) throw new Error("Incorrect byte range");
    const retrieval = await fetch(`${baseUrl}/api/retrieval`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: firstJob.id }) });
    await expectStatus(retrieval, 200, "create retrieval"); const { token } = await retrieval.json();
    const link = await rawFetch(`${baseUrl}/api/retrieval/${token}`); await expectStatus(link, 200, "separate-browser retrieval");
    const linkData = await link.json(); if (JSON.stringify(linkData).includes(sessionId)) throw new Error("Retrieval leaked private session");
    const retrievedMedia = await rawFetch(`${baseUrl}${linkData.mediaUrl}`); await expectStatus(retrievedMedia, 200, "retrieval MP4"); await retrievedMedia.arrayBuffer();
    await expectStatus(await fetch(`${baseUrl}/api/retrieval`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }), 200, "revoke retrieval");
    await expectStatus(await rawFetch(`${baseUrl}/api/retrieval/${token}`), 410, "revoked retrieval denied");
    const expiresResponse = await fetch(`${baseUrl}/api/retrieval`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: firstJob.id }) });
    const expiresToken = (await expiresResponse.json()).token;
    const tokenFile = path.join(process.cwd(), "data", "retrieval", `${createHash("sha256").update(expiresToken).digest("hex")}.json`);
    const tokenRecord = JSON.parse(await readFile(tokenFile, "utf8")); tokenRecord.expiresAt = Date.now() - 1; await writeFile(tokenFile, JSON.stringify(tokenRecord));
    await expectStatus(await rawFetch(`${baseUrl}/api/retrieval/${expiresToken}`), 410, "expired retrieval denied");
    const post = (url: string, body: unknown) => fetch(`${baseUrl}${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await expectStatus(await rawFetch(`${baseUrl}/api/operator`), 401, "unauthorized operator status");
    await expectStatus(await rawFetch(`${baseUrl}/api/operator`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "display", paused: false, demoOnly: false }) }), 401, "unauthorized operator action");
    await expectStatus(await post("/api/premiere", { jobId: firstJob.id, allPeopleAgree: false }), 400, "premiere requires explicit permission");
    const submission = await post("/api/premiere", { jobId: firstJob.id, consentBasis: "guardian", allPeopleAgree: true, promoReuse: false }); await expectStatus(submission, 200, "premiere submission");
    const entry = (await submission.json()).entry;
    await expectStatus(await rawFetch(`${baseUrl}/api/display/${entry.id}`), 404, "unapproved reel never public");
    await expectStatus(await post("/api/operator/login", { secret: operatorTestSecret }), 200, "operator login");
    const staffMedia = await fetch(`${baseUrl}/api/operator/media?id=${entry.id}`); await expectStatus(staffMedia, 200, "consented staff review"); await staffMedia.arrayBuffer();
    await expectStatus(await post("/api/operator", { action: "review", id: entry.id, status: "approved" }), 200, "operator approval");
    const playlist = await (await rawFetch(`${baseUrl}/api/display`)).json();
    if (!playlist.playlist.some((item: { id: string }) => item.id === entry.id) || JSON.stringify(playlist).includes(sessionId)) throw new Error("Public display isolation failed");
    const publicMedia = await rawFetch(`${baseUrl}/api/display/${entry.id}`); await expectStatus(publicMedia, 200, "approved reel public"); await publicMedia.arrayBuffer();
    await post("/api/operator", { action: "display", paused: true, demoOnly: false });
    await expectStatus(await rawFetch(`${baseUrl}/api/display/${entry.id}`), 404, "operator playback pause");
    await post("/api/operator", { action: "display", paused: false, demoOnly: false });
    await post("/api/operator", { action: "review", id: entry.id, status: "rejected" });
    await expectStatus(await rawFetch(`${baseUrl}/api/display/${entry.id}`), 404, "removed reel never public");
    await post("/api/premiere", { jobId: firstJob.id, consentBasis: "guardian", allPeopleAgree: true });
    await post("/api/operator", { action: "review", id: entry.id, status: "approved" });
    await expectStatus(await fetch(`${baseUrl}/api/premiere`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: entry.id }) }), 200, "visitor revokes screening");
    await expectStatus(await rawFetch(`${baseUrl}/api/display/${entry.id}`), 404, "revoked screening blocked");
    await expectStatus(await post("/api/operator", { action: "review", id: entry.id, status: "approved" }), 409, "staff cannot override revoked permission");
    await expectStatus(await post("/api/battle", { jobId: firstJob.id, nickname: "Calm Comets", optIn: false }), 400, "leaderboard opt-in required");
    await expectStatus(await post("/api/battle", { jobId: firstJob.id, nickname: "unsafe nickname", optIn: true }), 400, "curated nickname moderation");
    const score = await post("/api/battle", { jobId: firstJob.id, nickname: "Calm Comets", optIn: true, score: 999999 }); await expectStatus(score, 200, "verified leaderboard entry");
    if ((await score.json()).entry.score !== 100) throw new Error("Client changed score");
    await post("/api/battle", { jobId: firstJob.id, nickname: "Calm Comets", optIn: true });
    const standings = await (await rawFetch(`${baseUrl}/api/battle`)).json(); if (JSON.stringify(standings).includes(sessionId)) throw new Error("Leaderboard leaked session");
    const csrf = await rawFetch(`${baseUrl}/api/operator`, { method: "POST", headers: { Origin: "https://untrusted.example", "Content-Type": "application/json" }, body: "{}" }); await expectStatus(csrf, 403, "cross-origin mutation denied");

    const secondJob = await createJob(sessionId, "movie-trailer", "API regenerated test");
    const secondOutput = await waitForJob(secondJob.id);
    if (firstOutput.outputUrl === secondOutput.outputUrl) throw new Error("Regeneration reused the previous output path.");
    const concurrentSessions = await Promise.all([0, 1, 2].map(async () => {
      const id = await newSession();
      for (let shot = 1; shot <= 3; shot++) await expectStatus(await upload(id, shot, firstClip), 200, "concurrent visitor upload");
      return id;
    }));
    const requests = await Promise.all(concurrentSessions.map((id) => fetch(`${baseUrl}/api/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: id, presetId: "main-character", title: "Concurrency test" }) })));
    const admitted: { sessionId: string; id: string }[] = []; let rejected = 0;
    for (const [index, response] of requests.entries()) {
      if (response.ok) admitted.push({ sessionId: concurrentSessions[index], id: (await response.json()).job.id });
      else { await expectStatus(response, 429, "bounded queue admission"); rejected++; }
    }
    if (admitted.length !== 2 || rejected !== 1) throw new Error(`Unexpected admission counts: ${admitted.length}/${rejected}`);
    const duplicate = await fetch(`${baseUrl}/api/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: admitted[0].sessionId, presetId: "main-character", title: "Concurrency test" }) });
    if ((await duplicate.json()).job.id !== admitted[0].id) throw new Error("Duplicate submission created a new job");
    const concurrentOutputs = await Promise.all(admitted.map((item) => waitForJob(item.id)));
    if (concurrentOutputs[0].outputUrl === concurrentOutputs[1].outputUrl) throw new Error("Concurrent outputs collided");
    for (const [index, output] of concurrentOutputs.entries()) {
      const other = admitted[1 - index].sessionId;
      const wrongBrowser = await rawFetch(`${baseUrl}${output.outputUrl}`, { headers: { Cookie: `srs-${other}=${cookies.get(`srs-${other}`)}` } });
      await expectStatus(wrongBrowser, 401, "cross-session access denied");
    }
    console.log(JSON.stringify({ concurrentSessions: concurrentSessions.length, admitted: admitted.length, overloaded: rejected, concurrentOutputs }, null, 2));
    await stopServer(server);
    server = startServer();
    await waitForHealth();
    const recoveredResponse = await fetch(`${baseUrl}/api/jobs?id=${firstJob.id}`);
    await expectStatus(recoveredResponse, 200, "completed-job recovery after restart");
    const { job: recovered } = await recoveredResponse.json() as { job: { stage: string; consent: { publicDisplay: boolean; promoReuse: boolean } } };
    if (recovered.stage !== "completed" || !recovered.consent.publicDisplay || recovered.consent.promoReuse) throw new Error("Persisted job or consent record was not recovered correctly.");
    const recoveredDraftResponse = await fetch(`${baseUrl}/api/sessions/${sessionId}`);
    await expectStatus(recoveredDraftResponse, 200, "session draft recovery after restart");
    const { draft: recoveredDraft } = await recoveredDraftResponse.json() as { draft: { title: string; shots: unknown[] } };
    if (recoveredDraft.title !== draft.title || recoveredDraft.shots.length !== 3) throw new Error("Persisted studio draft was not recovered correctly.");
    console.log(JSON.stringify({ sessionId, firstOutput, secondOutput, metadata }, null, 2));
  } finally {
    await stopServer(server);
    await writeFile(nextEnvPath, originalNextEnv, "utf8");
  }
}

void main();
