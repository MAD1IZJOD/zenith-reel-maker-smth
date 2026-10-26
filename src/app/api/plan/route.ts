import path from "node:path";
import { NextResponse } from "next/server";
import { getPreset } from "@/lib/presets";
import { isCreativeVibe } from "@/lib/creative/options";
import { planCreative } from "@/lib/ai/creative-planner";
import { assertSessionId, sessionDirectory } from "@/lib/storage/session-storage";
import { errorResponse, HttpError, rateLimit, requireSession } from "@/lib/server/security";
import { readJson } from "@/lib/server/store";
import type { ShotAnalysis } from "@/lib/video/shot-analysis-types";

export const runtime = "nodejs";

/** Creative plan for the saved shots: local Qwen when it answers in time and validates, transparent rules otherwise. */
export async function POST(request: Request) {
  try {
    const body = await request.json() as { sessionId?: string; presetId?: string; vibe?: string; challenge?: string };
    const sessionId = assertSessionId(body.sessionId || "");
    await requireSession(request, sessionId);
    rateLimit(`plan:${sessionId}`, 8);
    const preset = getPreset(body.presetId || "");
    if (!preset) throw new HttpError(400, "Choose a valid preset.");
    const vibe = isCreativeVibe(body.vibe) ? body.vibe : "cinematic";
    const analyses = await Promise.all([1, 2, 3].map((shot) => readJson<ShotAnalysis>(path.join(sessionDirectory(sessionId), `shot-${shot}-analysis.json`)).catch(() => undefined)));
    const challenge = typeof body.challenge === "string" ? body.challenge.slice(0, 80) : undefined;
    return NextResponse.json(await planCreative(preset, vibe, analyses, challenge));
  } catch (error) { return errorResponse(error, "Could not prepare a plan. Your settings are unchanged."); }
}
