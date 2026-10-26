import { digest, HttpError } from "@/lib/server/security";
import { exclusive, recordPath, writeJson, readJson } from "@/lib/server/store";
import { challengeResult } from "@/lib/creative/challenges";
import { listJobs, type ReelJob } from "@/lib/jobs/queue";
import { eventDay, records } from "./records";
export const NICKNAMES = ["Calm Comets", "Bold Frames", "Neon Owls", "Cosmic Crew", "Silver Sparks", "Golden Pixels", "Lucky Lenses", "Retro Rockets"];
type Entry = { id: string; nickname: string; score: number; challenge: string; count: number; day: string; createdAt: number; expiresAt: number };
export const leaderboardEnabled = () => process.env.ENABLE_LEADERBOARD === "true";
export async function submitScore(job: ReelJob, nickname: string) {
  if (!leaderboardEnabled()) throw new HttpError(503, "The event leaderboard is disabled.");
  if (!NICKNAMES.includes(nickname)) throw new HttpError(400, "Choose one of the squad nicknames.");
  const result = challengeResult(job); if (!result) throw new HttpError(400, "Complete a Reel Battle export first.");
  const day = eventDay(); const id = digest(`${day}:${job.sessionId}`);
  return exclusive(`leaderboard:${id}`, async () => {
    const previous = await readJson<Entry>(recordPath("leaderboard", id));
    const completed = (await listJobs()).filter((item) => item.sessionId === job.sessionId && eventDay(item.createdAt) === day && challengeResult(item));
    const best = completed.sort((a, b) => challengeResult(b)!.score - challengeResult(a)!.score || a.createdAt - b.createdAt)[0] || job;
    const bestResult = challengeResult(best)!;
    const entry: Entry = { id, day, nickname: previous?.nickname || `${nickname} ${id.slice(0, 4).toUpperCase()}`, score: bestResult.score, challenge: bestResult.challenge, count: new Set(completed.map((item) => item.challengeId)).size, createdAt: previous?.createdAt || Date.now(), expiresAt: best.expiresAt };
    await writeJson(recordPath("leaderboard", id), entry); return entry;
  });
}
export async function leaderboard() {
  if (!leaderboardEnabled()) return [];
  return (await records<Entry>("leaderboard")).filter((entry) => entry.day === eventDay() && entry.expiresAt > Date.now()).sort((a, b) => b.score - a.score || b.count - a.count || a.createdAt - b.createdAt || a.id.localeCompare(b.id)).slice(0, 30).map((entry, index) => ({ rank: index + 1, nickname: entry.nickname, score: entry.score, challenge: entry.challenge, count: entry.count }));
}
