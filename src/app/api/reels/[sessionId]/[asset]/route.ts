import path from "node:path";
import { requireSession, errorResponse } from "@/lib/server/security";
import { serveMedia } from "@/lib/server/media";
import { sessionDirectory } from "@/lib/storage/session-storage";
import { probeVideo } from "@/lib/video/metadata";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ sessionId: string; asset: string }> }) {
  try {
    const { sessionId, asset } = await context.params;
    await requireSession(request, sessionId);
    if (!/^(shot-[1-3]\.mp4|reel-[a-f0-9-]{36}\.mp4|cover-reel-[a-f0-9-]{36}-[1-3]\.jpg)$/i.test(asset)) return new Response(null, { status: 404 });
    const file = path.join(sessionDirectory(sessionId), asset);
    const metadata = asset.startsWith("shot-") ? await probeVideo(file) : undefined;
    const mime = asset.endsWith(".jpg") ? "image/jpeg" : metadata?.formatName.includes("webm") || metadata?.formatName.includes("matroska") ? "video/webm" : "video/mp4";
    return await serveMedia(request, file, mime, asset.startsWith("shot-") ? asset : `squad-${asset}`);
  } catch (error) { return errorResponse(error, "Media is unavailable or expired."); }
}
