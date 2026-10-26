import { assertSessionId } from "@/lib/storage/session-storage";
import { errorResponse, HttpError, requireSession } from "@/lib/server/security";
import { batchView, reelFile } from "@/lib/podcast/batch";
import { zipStream } from "@/lib/podcast/zip";
import { countSafely } from "@/lib/festival/metrics";

export const runtime = "nodejs";

/** Streams the completed reels only; a partially finished batch yields a smaller archive, never a false "all ready". */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const sessionId = assertSessionId(new URL(request.url).searchParams.get("sessionId") || "");
    await requireSession(request, sessionId);
    const id = (await context.params).id;
    const view = await batchView(sessionId, id);
    const ready = view.reels.filter((reel) => reel.status === "completed");
    if (!ready.length) throw new HttpError(409, "No reels are ready yet.");
    const entries = await Promise.all(ready.map(async (reel) => ({ name: `zenith-reel-0${reel.index}.mp4`, file: await reelFile(sessionId, id, reel.index) })));
    countSafely("download_requests");
    return new Response(await zipStream(entries), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="zenith-reels-${ready.length}-of-${view.reels.length}.zip"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return errorResponse(error, "The archive is unavailable."); }
}
