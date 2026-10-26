import { NextResponse } from "next/server";
import { assertSessionId } from "@/lib/storage/session-storage";
import { errorResponse, HttpError, rateLimit, requireSession } from "@/lib/server/security";
import { readSource } from "@/lib/sources/store";
import { readTranscript } from "@/lib/transcription/service";
import { candidateWindows, DEFAULT_WINDOW, selectNonOverlapping } from "@/lib/highlights/candidates";
import { rankCandidates } from "@/lib/highlights/rank";

export const runtime = "nodejs";

/** Highlight candidates from the stored transcript. `rank=model` asks local Qwen to reorder a heuristic shortlist. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const params = new URL(request.url).searchParams;
    const sessionId = assertSessionId(params.get("sessionId") || "");
    await requireSession(request, sessionId);
    rateLimit(`candidates:${sessionId}`, 20);
    const id = (await context.params).id;
    const source = await readSource(sessionId, id);
    const transcript = await readTranscript(sessionId, id);
    if (!transcript) throw new HttpError(409, "Transcribe or import a transcript first.");
    const pool = candidateWindows(source.id, transcript, DEFAULT_WINDOW);
    if (params.get("rank") === "model") return NextResponse.json({ windows: pool.length, ...(await rankCandidates(pool, 3)) });
    return NextResponse.json({ windows: pool.length, candidates: selectNonOverlapping(pool, 3), rankedBy: "heuristic", latencyMs: 0 });
  } catch (error) { return errorResponse(error, "Highlights are unavailable."); }
}
