import { NextResponse } from "next/server";
import { assertSessionId } from "@/lib/storage/session-storage";
import { errorResponse, HttpError, rateLimit, requireSession } from "@/lib/server/security";
import { serveMedia } from "@/lib/server/media";
import { batchView, reelFile, updateReel } from "@/lib/podcast/batch";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; index: string }> };
const reelIndex = (value: string) => { const index = Number(value); if (![1, 2, 3].includes(index)) throw new HttpError(404, "Reel not found."); return index; };

/** Private playback and download of one completed reel, named zenith-reel-0N.mp4. */
export async function GET(request: Request, context: Context) {
  try {
    const sessionId = assertSessionId(new URL(request.url).searchParams.get("sessionId") || "");
    await requireSession(request, sessionId);
    const { id, index } = await context.params;
    const position = reelIndex(index);
    return await serveMedia(request, await reelFile(sessionId, id, position), "video/mp4", `zenith-reel-0${position}.mp4`);
  } catch (error) { return errorResponse(error, "This reel is unavailable."); }
}

/** Edit title/hook/trim, swap the highlight, change this reel's style, or simply retry. Other reels are untouched. */
export async function POST(request: Request, context: Context) {
  try {
    const body = await request.json() as { sessionId?: string; changes?: unknown; style?: unknown };
    const sessionId = assertSessionId(body.sessionId || "");
    await requireSession(request, sessionId);
    rateLimit(`reel-edit:${sessionId}`, 20);
    const { id, index } = await context.params;
    await updateReel(sessionId, id, reelIndex(index), body.changes, body.style);
    return NextResponse.json({ batch: await batchView(sessionId, id) }, { status: 202 });
  } catch (error) { return errorResponse(error, "Could not update this reel."); }
}
