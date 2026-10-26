import { randomUUID } from "node:crypto";
import { getJob } from "@/lib/jobs/queue";
import { exclusive, readJson, recordPath, writeJson } from "@/lib/server/store";
import { HttpError } from "@/lib/server/security";
import { records } from "./records";
import { countSafely } from "./metrics";
export type Premiere = { id: string; jobId: string; sessionId: string; status: "pending" | "approved" | "rejected" | "revoked"; consentBasis: "adult" | "guardian"; consentVersion: "festival-v1"; promoReuse: boolean; createdAt: number; expiresAt: number; reviewedAt?: number };
export type DisplaySettings = { paused: boolean; demoOnly: boolean };
export async function displaySettings() { return await readJson<DisplaySettings>(recordPath("settings", "display")) || { paused: false, demoOnly: false }; }
export async function submitPremiere(jobId: string, consentBasis: unknown, allPeopleAgree: unknown, promoReuse: unknown) {
  const job = await getJob(jobId); if (!job || job.stage !== "completed") throw new HttpError(400, "A finished reel is required.");
  if (!["adult", "guardian"].includes(String(consentBasis)) || allPeopleAgree !== true) throw new HttpError(400, "Confirm permission from everyone shown, including a parent or guardian for anyone under 18.");
  return exclusive(`premiere:${jobId}`, async () => {
    const previous = (await records<Premiere>("premieres")).find((item) => item.jobId === jobId && item.expiresAt > Date.now());
    if (previous && ["pending", "approved"].includes(previous.status)) return previous;
    const entry: Premiere = { id: previous?.id || randomUUID(), jobId, sessionId: job.sessionId, status: "pending", consentBasis: consentBasis as Premiere["consentBasis"], consentVersion: "festival-v1", promoReuse: promoReuse === true, createdAt: Date.now(), expiresAt: job.expiresAt };
    await writeJson(recordPath("premieres", entry.id), entry); countSafely("premiere_opt_ins"); return entry;
  });
}
export async function getPremiere(id: string) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new HttpError(404, "Submission unavailable.");
  const entry = await readJson<Premiere>(recordPath("premieres", id));
  if (!entry || entry.expiresAt <= Date.now()) throw new HttpError(404, "Submission expired or unavailable.");
  return entry;
}
export async function updatePremiere(id: string, status: Premiere["status"]) {
  const original = await getPremiere(id);
  return exclusive(`premiere:${original.jobId}`, async () => {
    const entry = await getPremiere(id);
    if (status === "approved" && entry.status !== "pending") throw new HttpError(409, "Only a pending, consented submission can be approved.");
    if (entry.status === "revoked" && status !== "revoked") throw new HttpError(409, "Visitor permission was revoked.");
    entry.status = status; entry.reviewedAt = Date.now(); await writeJson(recordPath("premieres", id), entry); return entry;
  });
}
export async function approvedPlaylist() {
  const settings = await displaySettings(); if (settings.paused || settings.demoOnly) return [];
  const approved = (await records<Premiere>("premieres")).filter((item) => item.status === "approved" && item.expiresAt > Date.now());
  const playlist = [];
  for (const item of approved) { const job = await getJob(item.jobId); if (job?.stage === "completed") playlist.push({ id: item.id, mediaUrl: `/api/display/${item.id}` }); }
  return playlist;
}
