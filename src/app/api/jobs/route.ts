import { NextResponse } from "next/server";
import { createJob, getJob } from "@/lib/jobs/queue";
import { getPreset } from "@/lib/presets";
import { assertCompleteSession, assertSessionId, cleanupExpiredSessions } from "@/lib/storage/session-storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { sessionId?: string; presetId?: string; title?: string };
    const sessionId = assertSessionId(body.sessionId || "");
    if (!getPreset(body.presetId || "")) throw new Error("Choose a valid preset.");
    await assertCompleteSession(sessionId);
    const job = createJob({ sessionId, presetId: body.presetId!, title: typeof body.title === "string" ? body.title.slice(0, 52) : undefined });
    void cleanupExpiredSessions();
    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not start export." }, { status: 400 });
  }
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") || "";
  const job = getJob(id);
  return job ? NextResponse.json({ job }) : NextResponse.json({ error: "Job expired or not found." }, { status: 404 });
}
