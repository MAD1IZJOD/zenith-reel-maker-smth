import type { CreativeVibe } from "@/lib/creative/options";
import type { ReelPreset } from "@/lib/presets";
import { CHALLENGES } from "@/lib/creative/challenges";

/** Transparent, deterministic creative assistance. This deliberately makes no LLM claim. */
export type StudioAssist = {
  director: { title: string; direction: string; angle: string; duration: string; example: string }[];
  editor: { title: string; transition: ReelPreset["transition"]; effect: ReelPreset["effect"] };
  hook: string;
  hookOptions: [string, string, string];
  captions: string[];
  cover: { title: string; frame: "first-second" };
  postCaption: string;
};

type DirectorInput = { challenge?: string; vibe?: CreativeVibe; advanced?: boolean };

const vibeDirection: Record<CreativeVibe, string> = {
  cinematic: "Move slowly and hold the final frame for a beat.",
  funny: "Keep the action clear and let the reaction do the work.",
  energetic: "Make one clean, confident movement toward the camera.",
  dramatic: "Start still, then reveal the action with a deliberate pause.",
  aesthetic: "Use even light and keep the frame simple and uncluttered.",
  nostalgic: "Capture a candid detail as if it is a memory worth keeping.",
};
const angles = ["Low or waist-level angle", "Eye-level close or side angle", "Wide, stable reveal"] as const;
const examples = ["Shoes enter the frame, then walk past.", "A clear expression or one distinctive detail.", "The final place, person, or group moment."] as const;

function hooksFor(preset: ReelPreset, vibe: CreativeVibe, challenge?: string): [string, string, string] {
  const lead = challenge ? `${challenge}: watch this` : preset.title;
  const tone: Record<CreativeVibe, string> = {
    cinematic: "This is your scene",
    funny: "That changed quickly",
    energetic: "Three shots. Full energy.",
    dramatic: "Wait for the reveal",
    aesthetic: "A moment worth replaying",
    nostalgic: "Keep this memory close",
  };
  return [lead.slice(0, 52), tone[vibe], `${preset.name} in three shots`];
}

/**
 * Provider-independent, deterministic studio guidance. It uses fixed, vetted
 * prompt fragments so festival visitors receive concise, age-appropriate advice
 * even when no external AI provider is configured.
 */
export function createStudioAssist(preset: ReelPreset, input: DirectorInput = {}): StudioAssist {
  const vibe = input.vibe || "cinematic";
  const hookOptions = hooksFor(preset, vibe, input.challenge);
  const challenge = CHALLENGES.find((item) => item.title === input.challenge);
  return {
    director: preset.shots.map((shot, index) => ({
      title: `Shot ${index + 1}: ${shot}`,
      direction: `${challenge && index === 0 ? `${challenge.title}. ` : ""}${challenge?.shots[index] || shot}. ${vibeDirection[vibe]}`,
      angle: input.advanced ? angles[index] : "Keep the camera steady.",
      duration: input.advanced ? "3–8 seconds" : "A short, clear moment",
      example: input.advanced ? examples[index] : "Focus on one readable action.",
    })),
    editor: { title: preset.title, transition: preset.transition, effect: preset.effect },
    hook: hookOptions[0],
    hookOptions,
    captions: [...preset.captions],
    cover: { title: preset.title, frame: "first-second" },
    postCaption: `${preset.name} made in three shots. #SquadReelStudio`,
  };
}
