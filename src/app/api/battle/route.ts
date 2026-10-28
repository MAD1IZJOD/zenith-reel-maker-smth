import { readJsonBody } from "@/lib/server/request-body";
import { NextResponse } from "next/server";
import { getJob } from "@/lib/jobs/queue";
import { challengeResult } from "@/lib/creative/challenges";
import { leaderboard, leaderboardEnabled, NICKNAMES, submitScore } from "@/lib/festival/leaderboard";
import { errorResponse, HttpError, rateLimit, requireSession } from "@/lib/server/security";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("jobId");
    if (!id) return NextResponse.json({ enabled: leaderboardEnabled(), entries: await leaderboard(), tieBreak: "Score, completed challenges, then earliest entry. Resets daily in India time." });
    const job = await getJob(id); if (!job) throw new HttpError(404, "Reel not found.");
    await requireSession(request, job.sessionId);
    return NextResponse.json({ result: challengeResult(job), enabled: leaderboardEnabled(), nicknames: NICKNAMES });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const { jobId, nickname, optIn } = await readJsonBody(request);
    const job = await getJob(String(jobId)); if (!job) throw new HttpError(404, "Reel not found.");
    await requireSession(request, job.sessionId); rateLimit(`score:${job.sessionId}`, 6);
    if (optIn !== true) throw new HttpError(400, "Leaderboard participation is optional and needs your confirmation.");
    return NextResponse.json({ entry: await submitScore(job, String(nickname)) });
  } catch (error) { return errorResponse(error); }
}
