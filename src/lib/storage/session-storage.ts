import { access, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { dataRoot, retentionMs } from "@/lib/server/config";
import { exclusive, readJson, recordPath, writeJson } from "@/lib/server/store";

const root = path.join(dataRoot(), "sessions");
const tokenPattern = /^[a-f0-9-]{36}$/i;
const jobsRoot = path.join(dataRoot(), "jobs");

export function createSessionId(): string { return randomUUID(); }
export function assertSessionId(value: string): string {
  if (!tokenPattern.test(value)) throw new Error("Invalid session.");
  return value;
}
export function sessionDirectory(sessionId: string): string { return path.join(root, assertSessionId(sessionId)); }
export async function ensureSession(sessionId: string): Promise<string> { const directory = sessionDirectory(sessionId); await mkdir(directory, { recursive: true }); return directory; }
function jobRecordPath(jobId: string): string { return path.join(jobsRoot, `${assertSessionId(jobId)}.json`); }
export async function writeJobRecord<T extends { id: string }>(job: T): Promise<void> {
  await writeJson(jobRecordPath(job.id), job);
}
export async function readJobRecord<T>(jobId: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(jobRecordPath(jobId), "utf8")) as T; }
  catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
export async function removeJobRecord(jobId: string): Promise<void> { await rm(jobRecordPath(jobId), { force: true }); }
function sessionDraftPath(sessionId: string): string { return path.join(sessionDirectory(sessionId), "draft.json"); }
export async function writeSessionDraft<T>(sessionId: string, draft: T): Promise<void> {
  await ensureSession(sessionId);
  await writeJson(sessionDraftPath(sessionId), draft);
}
export async function readSessionDraft<T>(sessionId: string): Promise<T | undefined> {
  // Same lock as writeJson: a restore that arrives while a save is being written reads the saved version.
  const file = sessionDraftPath(sessionId);
  return exclusive(`write:${file}`, async () => {
    try { return JSON.parse(await readFile(file, "utf8")) as T; }
    catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  });
}
export async function assertCompleteSession(sessionId: string): Promise<void> {
  const directory = sessionDirectory(sessionId);
  try { await Promise.all([1, 2, 3].map((shot) => access(path.join(directory, `shot-${shot}.mp4`)))); }
  catch { throw new Error("Add all three shots before generating your reel."); }
}
export async function cleanupExpiredSessions(): Promise<void> {
  const cutoff = Date.now() - retentionMs();
  const protectedSessions = new Set<string>();
  await mkdir(jobsRoot, { recursive: true });
  for (const record of await readdir(jobsRoot)) {
    if (!/^[a-f0-9-]{36}\.json$/i.test(record)) continue;
    const location = path.join(jobsRoot, record);
    const job = await readJson<{ sessionId: string; expiresAt: number; stage: string }>(location);
    if (job && !["completed", "failed"].includes(job.stage)) protectedSessions.add(job.sessionId);
    else if (job && job.expiresAt <= Date.now()) await rm(location, { force: true });
  }
  await mkdir(root, { recursive: true });
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !tokenPattern.test(entry.name) || protectedSessions.has(entry.name)) continue;
    await exclusive(`session:${entry.name}`, async () => {
      const folder = path.join(root, entry.name);
      const access = await readJson<{ expiresAt: number }>(recordPath("access", entry.name));
      if (access ? access.expiresAt <= Date.now() : (await stat(folder)).mtimeMs < cutoff) await rm(folder, { recursive: true, force: true });
    });
  }
  for (const collection of ["access", "retrieval", "premieres", "leaderboard"]) {
    const directory = path.join(dataRoot(), collection);
    await mkdir(directory, { recursive: true });
    for (const entry of await readdir(directory)) {
      if (!/^[a-f0-9-]{36,64}\.json$/i.test(entry)) continue;
      const location = path.join(directory, entry);
      const record = await readJson<{ expiresAt?: number; id?: string }>(location);
      if (record?.expiresAt && record.expiresAt <= Date.now() && !(record.id && protectedSessions.has(record.id))) await rm(location, { force: true });
    }
  }
}
