import { NextResponse } from "next/server";
import { parseCreativeOptions, validateCreativeInput } from "@/lib/creative/options";
import { createJob, getJob } from "@/lib/jobs/queue";
import { getPreset } from "@/lib/presets";
import { assertCompleteSession, assertSessionId, cleanupExpiredSessions } from "@/lib/storage/session-storage";
import { errorResponse, requireSession, HttpError } from "@/lib/server/security";
import { getChallenge } from "@/lib/creative/challenges";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { sessionId?: string; presetId?: string; title?: string; creative?: unknown; challengeId?: string; sourceJobId?: string; consent?: { publicDisplay?: boolean; promoReuse?: boolean } };
    const sessionId = assertSessionId(body.sessionId || "");
    await requireSession(request, sessionId);
    const preset = getPreset(body.presetId || "");
    if (!preset) throw new Error("Choose a valid preset.");
    try { validateCreativeInput(body.creative); } catch (error) { throw new HttpError(400, (error as Error).message); }
    if (!body.sourceJobId) await assertCompleteSession(sessionId);
    const job = await createJob({ sessionId, presetId: body.presetId!, sourceJobId: typeof body.sourceJobId === "string" ? body.sourceJobId : undefined, challengeId: getChallenge(body.challengeId)?.id, title: typeof body.title === "string" ? body.title.slice(0, 52) : undefined, creative: parseCreativeOptions(body.creative, preset), consent: { publicDisplay: body.consent?.publicDisplay === true, promoReuse: body.consent?.promoReuse === true } });
    void cleanupExpiredSessions();
    return NextResponse.json({ job });
  } catch (error) {
    return errorResponse(error, "Could not start export. Add three valid clips and try again.");
  }
}

export async function GET(request: Request) {
  try {
  const id = new URL(request.url).searchParams.get("id") || "";
  const job = await getJob(id);
  if (job) await requireSession(request, job.sessionId);
  return job ? NextResponse.json({ job }) : NextResponse.json({ error: "Job expired or not found." }, { status: 404 });
  } catch (error) { return errorResponse(error); }
}
