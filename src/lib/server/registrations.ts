import { readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { assertSessionId } from "@/lib/storage/session-storage";
import { dataRoot, limit } from "./config";
import { HttpError } from "./security";
import { exclusive, readJson, recordPath, writeJson } from "./store";

const fields = z.object({
  name: z.string().trim().min(1).max(100).refine((value) => !/[\u0000-\u001f\u007f]/.test(value)),
  email: z.string().trim().max(254).email().transform((value) => value.toLowerCase()),
  acknowledged: z.literal(true),
});
export type Registration = { sessionId: string; name: string; email: string; createdAt: number; expiresAt: number; noticeVersion: "2026-10-27" };
export const registrationDays = () => limit("REGISTRATION_RETENTION_DAYS", 30, 365);
export async function getRegistration(sessionId: string) {
  const record = await readJson<Registration>(recordPath("registrations", assertSessionId(sessionId)));
  return record && record.expiresAt > Date.now() ? record : undefined;
}
export async function requireRegistration(sessionId: string) {
  if (!await getRegistration(sessionId)) throw new HttpError(428, "Please enter your name and email before generating a reel. Reload to open the registration form.");
}
export async function saveRegistration(sessionId: string, input: unknown): Promise<void> {
  assertSessionId(sessionId);
  const parsed = fields.safeParse(input);
  if (!parsed.success) throw new HttpError(400, "Enter your name, a valid email address, and acknowledge the data notice.");
  await exclusive(`registration:${sessionId}`, async () => {
    const existing = await getRegistration(sessionId);
    const createdAt = existing?.createdAt ?? Date.now();
    await writeJson(recordPath("registrations", sessionId), {
      sessionId, name: parsed.data.name, email: parsed.data.email, createdAt,
      expiresAt: existing?.expiresAt ?? createdAt + registrationDays() * 86_400_000,
      noticeVersion: "2026-10-27",
    } satisfies Registration);
  });
}
export function csvCell(value: string): string {
  // Spreadsheet apps can evaluate formulas even inside quoted CSV cells.
  const safe = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export async function registrationCsv(): Promise<string> {
  let files: string[];
  try { files = await readdir(path.join(dataRoot(), "registrations")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") files = []; else throw error; }
  const records = [];
  for (const file of files.sort()) {
    if (!/^[a-f0-9-]{36}\.json$/i.test(file)) continue;
    const record = await getRegistration(file.slice(0, -5));
    if (record) records.push(record);
  }
  const rows = [["Name", "Email", "Session ID", "Registered at (UTC)", "Expires at (UTC)"]];
  for (const record of records) rows.push([record.name, record.email, record.sessionId, new Date(record.createdAt).toISOString(), new Date(record.expiresAt).toISOString()]);
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
