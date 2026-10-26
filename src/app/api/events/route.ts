import { countMetric } from "@/lib/festival/metrics";
import { errorResponse, HttpError, rateLimit, requireSession } from "@/lib/server/security";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const { sessionId, event } = await request.json(); await requireSession(request, String(sessionId)); rateLimit(`events:${sessionId}`, 20);
    if (!["camera_selected", "upload_selected"].includes(event)) throw new HttpError(400, "Unknown event.");
    await countMetric(event); return Response.json({ recorded: true });
  } catch (error) { return errorResponse(error); }
}
