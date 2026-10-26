import { NextResponse } from "next/server";
import { PRESETS } from "@/lib/presets";
import { assertSessionId, readSessionDraft, writeSessionDraft } from "@/lib/storage/session-storage";

export const runtime = "nodejs";
const screens = new Set(["welcome", "presets", "record", "review", "processing", "preview"]);
const stages = new Set(["queued", "validating", "preparing", "rendering", "finalizing", "completed", "failed"]);

type DraftShot = { previewUrl: string; duration: number; name: string } | null;
type SessionDraft = { presetId: string; title: string; shots: DraftShot[]; activeShot: number; challenge?: string; screen: string; job?: { id: string; stage: string; error?: string; outputUrl?: string; coverUrl?: string }; publicDisplay: boolean; promoReuse: boolean };

function parseDraft(input: unknown, sessionId: string): SessionDraft {
  if (typeof input !== "object" || input === null) throw new Error("Invalid session draft.");
  const value = input as Record<string, unknown>;
  if (!PRESETS.some((preset) => preset.id === value.presetId) || typeof value.title !== "string" || !Array.isArray(value.shots) || value.shots.length !== 3 || !screens.has(String(value.screen))) throw new Error("Invalid session draft.");
  const shots = value.shots.map((shot) => {
    if (shot === null) return null;
    if (typeof shot !== "object" || !shot || typeof (shot as Record<string, unknown>).previewUrl !== "string" || typeof (shot as Record<string, unknown>).duration !== "number" || typeof (shot as Record<string, unknown>).name !== "string") throw new Error("Invalid session draft.");
    const parsed = shot as { previewUrl: string; duration: number; name: string };
    if (!parsed.previewUrl.startsWith(`/api/reels/${sessionId}/shot-`)) throw new Error("Invalid session draft.");
    return { previewUrl: parsed.previewUrl, duration: parsed.duration, name: parsed.name.slice(0, 160) };
  });
  const job = value.job;
  if (job !== undefined && (typeof job !== "object" || job === null || typeof (job as Record<string, unknown>).id !== "string" || !stages.has(String((job as Record<string, unknown>).stage)))) throw new Error("Invalid session draft.");
  return { presetId: value.presetId as string, title: value.title.slice(0, 52), shots, activeShot: Number.isInteger(value.activeShot) && Number(value.activeShot) >= 0 && Number(value.activeShot) <= 2 ? Number(value.activeShot) : 0, challenge: typeof value.challenge === "string" ? value.challenge.slice(0, 80) : undefined, screen: value.screen as string, job: job as SessionDraft["job"], publicDisplay: value.publicDisplay === true, promoReuse: value.promoReuse === true };
}

export async function GET(_: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const sessionId = assertSessionId((await context.params).sessionId);
    const draft = await readSessionDraft<SessionDraft>(sessionId);
    return draft ? NextResponse.json({ draft }) : NextResponse.json({ error: "No saved session." }, { status: 404 });
  } catch { return NextResponse.json({ error: "Session not found." }, { status: 404 }); }
}

export async function PUT(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const sessionId = assertSessionId((await context.params).sessionId);
    const draft = parseDraft(await request.json(), sessionId);
    await writeSessionDraft(sessionId, draft);
    return NextResponse.json({ saved: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save session." }, { status: 400 }); }
}
