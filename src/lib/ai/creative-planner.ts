import { z } from "zod";
import type { ReelPreset } from "@/lib/presets";
import { cleanCreativeText, type CreativeOptions, type CreativeVibe } from "@/lib/creative/options";
import { CAPTION_STYLES, GRADES, PACINGS, RECIPES, TRANSITION_FAMILIES, type Grade, type Pacing, type TransitionFamily } from "@/lib/edit/styles";
import type { ShotAnalysis } from "@/lib/video/shot-analysis-types";
import { createStudioAssist } from "./studio";
import { creativeModel, ProviderError, type LocalModelProvider } from "./provider";

/** Plain-language facts measured from footage. The text model never sees pixels; it sees these. */
export type ShotObservation = { shot: number; intent: string; seconds: number; orientation: string; light: "dark" | "normal" | "bright" | "unknown"; motion: "low" | "medium" | "high" | "unknown"; speech: boolean };

export function observe(preset: ReelPreset, analyses: (ShotAnalysis | undefined)[]): ShotObservation[] {
  return preset.shots.map((intent, index) => {
    const analysis = analyses[index];
    const motion = analysis?.activity?.motion.slice(1) || [];
    const meanMotion = motion.length ? motion.reduce((a, b) => a + b, 0) / motion.length : undefined;
    const audio = analysis?.activity?.audio || [];
    return {
      shot: index + 1, intent, seconds: Math.round((analysis?.duration || 0) * 10) / 10, orientation: analysis?.orientation || "unknown",
      light: analysis?.brightness === undefined ? "unknown" : analysis.brightness < 0.13 ? "dark" : analysis.brightness > 0.85 ? "bright" : "normal",
      motion: meanMotion === undefined ? "unknown" : meanMotion < 3 ? "low" : meanMotion < 9 ? "medium" : "high",
      speech: audio.length > 0 && audio.filter((value) => value > -32).length / audio.length > 0.3,
    };
  });
}

export const planSchema = z.object({
  hook: z.string().min(2).max(60),
  hookAlternatives: z.array(z.string().min(2).max(60)).min(1).max(2),
  shotOrder: z.array(z.number().int().min(1).max(3)).length(3).refine((order) => new Set(order).size === 3, "Shot order must use each shot once."),
  pacing: z.enum(PACINGS),
  transitionStyle: z.enum(TRANSITION_FAMILIES),
  grade: z.enum(GRADES),
  captionStyle: z.enum(CAPTION_STYLES),
  captions: z.array(z.string().min(1).max(60)).length(3),
  rationale: z.string().max(160),
});
export type ModelPlan = z.infer<typeof planSchema>;

/** JSON schema handed to the runtime's constrained decoder; mirrors planSchema. */
const planJsonSchema = {
  type: "object", additionalProperties: false,
  required: ["hook", "hookAlternatives", "shotOrder", "pacing", "transitionStyle", "grade", "captionStyle", "captions", "rationale"],
  properties: {
    hook: { type: "string", maxLength: 52 }, hookAlternatives: { type: "array", items: { type: "string", maxLength: 40 }, minItems: 1, maxItems: 2 },
    shotOrder: { type: "array", items: { type: "integer", minimum: 1, maximum: 3 }, minItems: 3, maxItems: 3 },
    pacing: { type: "string", enum: [...PACINGS] }, transitionStyle: { type: "string", enum: [...TRANSITION_FAMILIES] },
    grade: { type: "string", enum: [...GRADES] }, captionStyle: { type: "string", enum: [...CAPTION_STYLES] },
    captions: { type: "array", items: { type: "string", maxLength: 24 }, minItems: 3, maxItems: 3 }, rationale: { type: "string", maxLength: 120 },
  },
};

export type PlanPatch = Pick<CreativeOptions, "hook" | "shotOrder" | "pacing" | "transitionStyle" | "grade" | "captionStyle" | "captions" | "planSource">;
export type PlanResult = { patch: PlanPatch; hookOptions: string[]; rationale: string; source: "qwen" | "rules"; model?: string; latencyMs: number; fallbackReason?: string };

const VIBE_RULES: Record<CreativeVibe, { pacing: Pacing; transitions: TransitionFamily; grade?: Grade }> = {
  cinematic: { pacing: "relaxed", transitions: "smooth" }, funny: { pacing: "punchy", transitions: "minimal", grade: "bright-social" },
  energetic: { pacing: "punchy", transitions: "energetic", grade: "bright-social" }, dramatic: { pacing: "balanced", transitions: "smooth", grade: "contrast-editorial" },
  aesthetic: { pacing: "relaxed", transitions: "smooth", grade: "clean-neutral" }, nostalgic: { pacing: "relaxed", transitions: "smooth", grade: "soft-nostalgia" },
};

/** Transparent rules used whenever the model is unavailable, slow or returns anything invalid. */
export function rulesPlan(preset: ReelPreset, vibe: CreativeVibe, observations: ShotObservation[], challenge?: string): PlanResult {
  const assist = createStudioAssist(preset, { vibe, challenge });
  const rule = VIBE_RULES[vibe];
  const order: [number, number, number] = [0, 1, 2];
  // Movie Trailer and Plot Twist land harder when the most active shot is the payoff.
  if (["movie-trailer", "plot-twist"].includes(preset.id)) {
    const rank = { high: 3, medium: 2, low: 1, unknown: 0 } as const;
    const strongest = [0, 1, 2].reduce((best, index) => (rank[observations[index].motion] > rank[observations[best].motion] ? index : best), 2);
    if (strongest !== 2) { order[2] = strongest; order[strongest] = 2; }
  }
  return {
    patch: { hook: assist.hookOptions[0], shotOrder: order, pacing: rule.pacing, transitionStyle: preset.id === "beat-sync" ? "energetic" : rule.transitions, grade: rule.grade || RECIPES[preset.id].grade, captionStyle: RECIPES[preset.id].captionStyle, captions: [...preset.captions], planSource: "rules" },
    hookOptions: assist.hookOptions, source: "rules", latencyMs: 0,
    rationale: `${vibe[0].toUpperCase()}${vibe.slice(1)} vibe: ${rule.pacing} pacing with ${rule.transitions} transitions.${order[2] !== 2 ? " The most active shot moves to the payoff." : ""}`,
  };
}

function prompt(preset: ReelPreset, vibe: CreativeVibe, observations: ShotObservation[], challenge?: string) {
  return [
    { role: "system" as const, content: "You are the editor of short vertical festival reels for a general audience. Choose only from the allowed values. Keep every field short (measured local speed is about 6 words per second). Hooks are 2-6 words, punchy, family-friendly, no hashtags or emoji. Captions are 1-4 words, one per shot in the ORIGINAL shot numbering. Reply with JSON only." },
    { role: "user" as const, content: JSON.stringify({ style: preset.name, styleDescription: preset.description, vibe, challenge: challenge || null, shots: observations, rules: "shotOrder lists shot numbers 1-3 in playback order. Prefer an action or a strong face early, and the biggest moment last." }) },
  ];
}

export async function planCreative(preset: ReelPreset, vibe: CreativeVibe, analyses: (ShotAnalysis | undefined)[], challenge?: string, provider: LocalModelProvider = creativeModel()): Promise<PlanResult> {
  const observations = observe(preset, analyses);
  const fallback = rulesPlan(preset, vibe, observations, challenge);
  try {
    const { value, latencyMs, model } = await provider.structured({ name: "reel_plan", schema: planSchema, jsonSchema: planJsonSchema, messages: prompt(preset, vibe, observations, challenge), maxTokens: 220 });
    const hook = cleanCreativeText(value.hook, fallback.patch.hook);
    const captions = value.captions.map((caption, index) => cleanCreativeText(caption, preset.captions[index], 44)) as [string, string, string];
    return {
      patch: { hook, shotOrder: value.shotOrder.map((shot) => shot - 1) as [number, number, number], pacing: value.pacing, transitionStyle: value.transitionStyle, grade: value.grade, captionStyle: value.captionStyle, captions, planSource: "qwen" },
      hookOptions: [hook, ...value.hookAlternatives.map((item) => cleanCreativeText(item, "")).filter((item) => item && item !== hook)].slice(0, 3),
      rationale: cleanCreativeText(value.rationale, "", 240), source: "qwen", model, latencyMs,
    };
  } catch (error) {
    return { ...fallback, fallbackReason: error instanceof ProviderError ? error.message : "The local model could not plan this edit." };
  } finally {
    // Free the model's memory before the visitor generates: renders must never compete with an idle 8B model.
    await provider.release();
  }
}
