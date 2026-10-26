import type { ReelPreset } from "@/lib/presets";

/** Transparent, deterministic creative assistance. This deliberately makes no LLM claim. */
export type StudioAssist = {
  director: { shot: string; direction: string }[];
  editor: { title: string; transition: ReelPreset["transition"]; effect: ReelPreset["effect"] };
  hook: string;
  captions: string[];
  cover: { title: string; frame: "first-second" };
  postCaption: string;
};

export function createStudioAssist(preset: ReelPreset, challenge?: string): StudioAssist {
  return {
    director: preset.shots.map((shot, index) => ({ shot, direction: challenge && index === 0 ? `${challenge}: ${shot}` : shot })),
    editor: { title: preset.title, transition: preset.transition, effect: preset.effect },
    hook: preset.title,
    captions: [...preset.captions],
    cover: { title: preset.title, frame: "first-second" },
    postCaption: `${preset.name} made in three shots. #SquadReelStudio`,
  };
}
