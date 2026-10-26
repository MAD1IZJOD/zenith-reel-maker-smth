import { assertSessionId } from "@/lib/storage/session-storage";
import { errorResponse, HttpError, requireSession } from "@/lib/server/security";
import { serveMedia } from "@/lib/server/media";
import { readSource, sourceMediaPath } from "@/lib/sources/store";
import { requirePodcastMode } from "@/lib/server/features";

export const runtime = "nodejs";

/** Private, range-capable playback of an imported source for highlight previews. Never publicly listed. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requirePodcastMode();
    const sessionId = assertSessionId(new URL(request.url).searchParams.get("sessionId") || "");
    await requireSession(request, sessionId);
    const source = await readSource(sessionId, (await context.params).id);
    if (source.status !== "ready" || !source.media) throw new HttpError(404, "Source not ready.");
    return await serveMedia(request, sourceMediaPath(sessionId, source.id), source.media.hasVideo ? "video/mp4" : "audio/mp4", "zenith-source");
  } catch (error) { return errorResponse(error, "Media unavailable."); }
}
