import { readJsonBody } from "@/lib/server/request-body";
import { countMetric } from "@/lib/festival/metrics";
import { errorResponse, HttpError, rateLimit, requireSession } from "@/lib/server/security";
import { getPreset } from "@/lib/presets";
import { getChallenge } from "@/lib/creative/challenges";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const { sessionId, event, presetId, challengeId } = await readJsonBody(request); await requireSession(request, String(sessionId)); rateLimit(`events:${sessionId}`, 30);
    const metric = event === "preset_selected" && typeof presetId === "string" && getPreset(presetId)?.id ? `preset_${presetId}` : event === "challenge_started" && typeof challengeId === "string" && getChallenge(challengeId)?.id ? `challenge_${challengeId}` : event === "camera_selected" || event === "upload_selected" ? event : undefined;
    if (!metric) throw new HttpError(400, "Unknown event.");
    await countMetric(metric); return Response.json({ recorded: true });
  } catch (error) { return errorResponse(error); }
}
