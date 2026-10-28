import { readJsonBody } from "@/lib/server/request-body";
import { requireRegistration } from "@/lib/server/registrations";
import { NextResponse } from "next/server";
import { assertSessionId } from "@/lib/storage/session-storage";
import { errorResponse, rateLimit, requireSession } from "@/lib/server/security";
import { batchView, createBatch } from "@/lib/podcast/batch";
import { requirePodcastMode } from "@/lib/server/features";

export const runtime = "nodejs";

/** Starts one independent render per selected highlight (up to three) and returns the batch with live statuses. */
export async function POST(request: Request) {
  try {
    await requirePodcastMode();
    const body = await readJsonBody(request) as { sessionId?: string; sourceId?: unknown; preferences?: unknown; style?: unknown; reels?: unknown; brollIds?: unknown };
    const sessionId = assertSessionId(body.sessionId || "");
    await requireSession(request, sessionId);
    await requireRegistration(sessionId);
    rateLimit(`batch:${sessionId}`, 6);
    const batch = await createBatch(sessionId, body);
    return NextResponse.json({ batch: await batchView(sessionId, batch.id) }, { status: 202 });
  } catch (error) { return errorResponse(error, "Could not start the reels."); }
}
