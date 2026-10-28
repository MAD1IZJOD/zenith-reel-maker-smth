import { readJsonBody } from "@/lib/server/request-body";
import { NextResponse } from "next/server";
import { assertSessionId } from "@/lib/storage/session-storage";
import { errorResponse, HttpError, rateLimit, requireSession } from "@/lib/server/security";
import { readTranscript, saveImportedTranscript, startTranscription } from "@/lib/transcription/service";
import { requirePodcastMode } from "@/lib/server/features";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    await requirePodcastMode();
    const sessionId = assertSessionId(new URL(request.url).searchParams.get("sessionId") || "");
    await requireSession(request, sessionId);
    const transcript = await readTranscript(sessionId, (await context.params).id);
    return transcript ? NextResponse.json({ transcript }) : NextResponse.json({ error: "No transcript yet." }, { status: 404 });
  } catch (error) { return errorResponse(error, "Transcript unavailable."); }
}

/** `{ action: "transcribe" }` runs local faster-whisper; `{ action: "import", text }` stores SRT, WebVTT or JSON. */
export async function POST(request: Request, context: Context) {
  try {
    await requirePodcastMode();
    const body = await readJsonBody(request, 4 * 1024 * 1024) as { sessionId?: string; action?: string; language?: string; text?: string };
    const sessionId = assertSessionId(body.sessionId || "");
    await requireSession(request, sessionId);
    rateLimit(`transcript:${sessionId}`, 10);
    const id = (await context.params).id;
    if (body.action === "transcribe") return NextResponse.json({ source: await startTranscription(sessionId, id, typeof body.language === "string" ? body.language.toLowerCase() : undefined) }, { status: 202 });
    if (body.action === "import" && typeof body.text === "string") return NextResponse.json({ source: await saveImportedTranscript(sessionId, id, body.text) });
    throw new HttpError(400, "Choose transcribe, or import a transcript file.");
  } catch (error) { return errorResponse(error, "Could not process this transcript."); }
}
