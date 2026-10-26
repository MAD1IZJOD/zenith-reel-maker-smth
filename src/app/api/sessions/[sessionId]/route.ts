import { NextResponse } from "next/server";
import { parseCreativeOptions, type CreativeOptions } from "@/lib/creative/options";
import { PRESETS } from "@/lib/presets";
import { assertSessionId, readSessionDraft, writeSessionDraft } from "@/lib/storage/session-storage";
import { errorResponse, requireSession } from "@/lib/server/security";

export const runtime = "nodejs";
const screens = new Set(["welcome", "presets", "director", "record", "review", "customize", "processing", "preview"]);
const stages = new Set(["queued", "validating", "preparing", "rendering", "finalizing", "completed", "failed"]);

type DraftShot = { previewUrl: string; duration: number; name: string } | null;
type DraftJob = { id: string; presetId?: string; stage: string; error?: string; outputUrl?: string; coverUrl?: string; coverUrls?: string[]; metrics?: { queueWaitMs?: number; renderDurationMs?: number; completedAt?: number; outputDurationSeconds?: number; outputBytes?: number } };
type SessionDraft = { presetId: string; title: string; creative: CreativeOptions; shots: DraftShot[]; activeShot: number; challenge?: string; screen: string; advancedGuidance: boolean; job?: DraftJob; renders: DraftJob[]; selectedCoverUrl?: string; achievements: string[]; publicDisplay: boolean; promoReuse: boolean };

function isSessionAsset(value: unknown, sessionId: string, prefix: "reel" | "cover"): value is string {
  if (typeof value !== "string") return false;
  const expression = prefix === "reel"
    ? new RegExp(`^/api/reels/${sessionId}/reel-[a-f0-9-]{36}\\.mp4$`, "i")
    : new RegExp(`^/api/reels/${sessionId}/cover-reel-[a-f0-9-]{36}-[1-3]\\.jpg$`, "i");
  return expression.test(value);
}

function parseJob(value: unknown, sessionId: string): DraftJob | undefined {
  if (typeof value !== "object" || value === null || typeof (value as Record<string, unknown>).id !== "string" || !stages.has(String((value as Record<string, unknown>).stage))) return undefined;
  const input = value as Record<string, unknown>;
  const coverUrls = Array.isArray(input.coverUrls) ? input.coverUrls.filter((url) => isSessionAsset(url, sessionId, "cover")) : undefined;
  const metrics = typeof input.metrics === "object" && input.metrics !== null ? input.metrics as DraftJob["metrics"] : undefined;
  return {
    id: input.id as string,
    presetId: PRESETS.some((preset) => preset.id === input.presetId) ? input.presetId as string : undefined,
    stage: String(input.stage),
    error: typeof input.error === "string" ? input.error.slice(0, 500) : undefined,
    outputUrl: isSessionAsset(input.outputUrl, sessionId, "reel") ? input.outputUrl : undefined,
    coverUrl: isSessionAsset(input.coverUrl, sessionId, "cover") ? input.coverUrl : undefined,
    coverUrls,
    metrics,
  };
}

function parseDraft(input: unknown, sessionId: string): SessionDraft {
  if (typeof input !== "object" || input === null) throw new Error("Invalid session draft.");
  const value = input as Record<string, unknown>;
  const preset = PRESETS.find((item) => item.id === value.presetId);
  if (!preset || typeof value.title !== "string" || !Array.isArray(value.shots) || value.shots.length !== 3 || !screens.has(String(value.screen))) throw new Error("Invalid session draft.");
  const shots = value.shots.map((shot) => {
    if (shot === null) return null;
    if (typeof shot !== "object" || !shot || typeof (shot as Record<string, unknown>).previewUrl !== "string" || typeof (shot as Record<string, unknown>).duration !== "number" || typeof (shot as Record<string, unknown>).name !== "string") throw new Error("Invalid session draft.");
    const parsed = shot as { previewUrl: string; duration: number; name: string };
    if (!parsed.previewUrl.startsWith(`/api/reels/${sessionId}/shot-`)) throw new Error("Invalid session draft.");
    return { previewUrl: parsed.previewUrl, duration: parsed.duration, name: parsed.name.slice(0, 160) };
  });
  const job = value.job === undefined ? undefined : parseJob(value.job, sessionId);
  if (value.job !== undefined && !job) throw new Error("Invalid session draft.");
  const renders = Array.isArray(value.renders) ? value.renders.map((render) => parseJob(render, sessionId)).filter((render): render is DraftJob => Boolean(render && render.stage === "completed" && render.outputUrl)) : [];
  const achievements = Array.isArray(value.achievements) ? value.achievements.filter((achievement): achievement is string => typeof achievement === "string" && ["first-reel", "three-shot-finisher", "challenge-complete", "squad-creator", "style-explorer"].includes(achievement)).slice(0, 5) : [];
  return {
    presetId: preset.id,
    title: value.title.slice(0, 52),
    creative: parseCreativeOptions(value.creative, preset),
    shots,
    activeShot: Number.isInteger(value.activeShot) && Number(value.activeShot) >= 0 && Number(value.activeShot) <= 2 ? Number(value.activeShot) : 0,
    challenge: typeof value.challenge === "string" ? value.challenge.slice(0, 80) : undefined,
    screen: value.screen as string,
    advancedGuidance: value.advancedGuidance === true,
    job,
    renders,
    selectedCoverUrl: isSessionAsset(value.selectedCoverUrl, sessionId, "cover") ? value.selectedCoverUrl : undefined,
    achievements,
    publicDisplay: value.publicDisplay === true,
    promoReuse: value.promoReuse === true,
  };
}

export async function GET(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const sessionId = assertSessionId((await context.params).sessionId);
    await requireSession(request, sessionId);
    const draft = await readSessionDraft<SessionDraft>(sessionId);
    return draft ? NextResponse.json({ draft }) : NextResponse.json({ error: "No saved session." }, { status: 404 });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const sessionId = assertSessionId((await context.params).sessionId);
    await requireSession(request, sessionId);
    const draft = parseDraft(await request.json(), sessionId);
    await writeSessionDraft(sessionId, draft);
    return NextResponse.json({ saved: true });
  } catch (error) { return errorResponse(error, "Could not save session."); }
}
