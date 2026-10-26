import { NextResponse } from "next/server";
import { assertSessionId } from "@/lib/storage/session-storage";
import { errorResponse, requireSession } from "@/lib/server/security";
import { batchView } from "@/lib/podcast/batch";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const sessionId = assertSessionId(new URL(request.url).searchParams.get("sessionId") || "");
    await requireSession(request, sessionId);
    return NextResponse.json({ batch: await batchView(sessionId, (await context.params).id) });
  } catch (error) { return errorResponse(error, "Batch not found."); }
}
