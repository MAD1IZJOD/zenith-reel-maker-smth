import { NextResponse } from "next/server";
import { assertSessionId } from "@/lib/storage/session-storage";
import { errorResponse, HttpError, requireSession } from "@/lib/server/security";
import { isActive, listJobs } from "@/lib/jobs/queue";
import { readSource, removeSource } from "@/lib/sources/store";
import { requirePodcastMode } from "@/lib/server/features";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

async function authorize(request: Request) {
  const sessionId = assertSessionId(new URL(request.url).searchParams.get("sessionId") || "");
  await requireSession(request, sessionId);
  return sessionId;
}

export async function GET(request: Request, context: Context) {
  try { await requirePodcastMode(); return NextResponse.json({ source: await readSource(await authorize(request), (await context.params).id) }); }
  catch (error) { return errorResponse(error, "Source not found."); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const sessionId = await authorize(request), id = (await context.params).id;
    // Reels still rendering from this source (or using it as b-roll) keep it until they finish.
    if ((await listJobs()).some((job) => job.sessionId === sessionId && isActive(job) && (job.highlight?.importId === id || job.highlight?.brollIds.includes(id)))) throw new HttpError(409, "Reels are still rendering from this source.");
    await removeSource(sessionId, id); return NextResponse.json({ removed: true });
  }
  catch (error) { return errorResponse(error, "Could not remove this source."); }
}
