import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { dataRoot } from "@/lib/server/config";

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
  await mkdir(jobsRoot, { recursive: true });
  const target = jobRecordPath(job.id);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(job), "utf8");
  await rename(temporary, target);
}
export async function readJobRecord<T>(jobId: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(jobRecordPath(jobId), "utf8")) as T; }
  catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
export async function removeJobRecord(jobId: string): Promise<void> { await rm(jobRecordPath(jobId), { force: true }); }
function sessionDraftPath(sessionId: string): string { return path.join(sessionDirectory(sessionId), "draft.json"); }
export async function writeSessionDraft<T>(sessionId: string, draft: T): Promise<void> {
  const directory = await ensureSession(sessionId);
  const target = sessionDraftPath(sessionId);
  const temporary = path.join(directory, `draft-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(draft), "utf8");
  await rename(temporary, target);
}
export async function readSessionDraft<T>(sessionId: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(sessionDraftPath(sessionId), "utf8")) as T; }
  catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
export async function assertCompleteSession(sessionId: string): Promise<void> {
  const directory = sessionDirectory(sessionId);
  try { await Promise.all([1, 2, 3].map((shot) => access(path.join(directory, `shot-${shot}.mp4`)))); }
  catch { throw new Error("Add all three shots before generating your reel."); }
}
export async function cleanupExpiredSessions(): Promise<void> {
  const retentionHours = Math.max(1, Number(process.env.RETENTION_HOURS || 24));
  const cutoff = Date.now() - retentionHours * 3_600_000;
  try {
    const entries = await readdir(root, { withFileTypes: true });
    await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const folder = path.join(root, entry.name);
      if ((await stat(folder)).mtimeMs < cutoff) await rm(folder, { recursive: true, force: true });
    }));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    const records = await readdir(jobsRoot, { withFileTypes: true });
    await Promise.all(records.filter((record) => record.isFile() && record.name.endsWith(".json")).map(async (record) => {
      const location = path.join(jobsRoot, record.name);
      if ((await stat(location)).mtimeMs < cutoff) await rm(location, { force: true });
    }));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
