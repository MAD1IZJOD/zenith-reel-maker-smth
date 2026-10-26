import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const root = path.join(process.cwd(), "data", "sessions");
const tokenPattern = /^[a-f0-9-]{36}$/i;

export function createSessionId(): string { return randomUUID(); }
export function assertSessionId(value: string): string {
  if (!tokenPattern.test(value)) throw new Error("Invalid session.");
  return value;
}
export function sessionDirectory(sessionId: string): string { return path.join(root, assertSessionId(sessionId)); }
export async function ensureSession(sessionId: string): Promise<string> { const directory = sessionDirectory(sessionId); await mkdir(directory, { recursive: true }); return directory; }
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
}
