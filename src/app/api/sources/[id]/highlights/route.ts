import { NextResponse } from "next/server";
import { assertSessionId } from "@/lib/storage/session-storage";
import { errorResponse, rateLimit, requireSession } from "@/lib/server/security";
import { highlightsFor, parsePreferences, publicDiscovery } from "@/lib/highlights/service";

export const runtime = "nodejs";

/** Three distinct highlights plus alternatives, from the stored transcript. Cached per transcript and preferences. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const body = await request.json() as { sessionId?: string; preferences?: unknown; refresh?: boolean };
    const sessionId = assertSessionId(body.sessionId || "");
    await requireSession(request, sessionId);
    rateLimit(`highlights:${sessionId}`, 12);
    return NextResponse.json(publicDiscovery(await highlightsFor(sessionId, (await context.params).id, parsePreferences(body.preferences), body.refresh === true)));
  } catch (error) { return errorResponse(error, "Highlights are unavailable."); }
}
