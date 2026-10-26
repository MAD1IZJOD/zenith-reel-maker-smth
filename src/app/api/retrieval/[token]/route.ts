import path from "node:path";
import { NextResponse } from "next/server";
import { resolveRetrieval } from "@/lib/server/retrieval";
import { errorResponse, networkKey, rateLimit } from "@/lib/server/security";
import { serveMedia } from "@/lib/server/media";
import { sessionDirectory } from "@/lib/storage/session-storage";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    rateLimit(`retrieve:${networkKey(request)}`, 240);
    const { token } = await context.params; const { job, record } = await resolveRetrieval(token);
    if (new URL(request.url).searchParams.has("media")) return await serveMedia(request, path.join(sessionDirectory(job.sessionId), `reel-${job.id}.mp4`), "video/mp4", `zenith-reel-${job.presetId}.mp4`);
    return NextResponse.json({ title: job.title, presetId: job.presetId, expiresAt: record.expiresAt, mediaUrl: `/api/retrieval/${token}?media=1` });
  } catch (error) { return errorResponse(error); }
}
