import type { ReelPreset } from "@/lib/presets";

export const VIBES = ["cinematic", "funny", "energetic", "dramatic", "aesthetic", "nostalgic"] as const;
export const CAPTION_STYLES = ["minimal", "cinematic", "bold", "retro"] as const;
export const AUDIO_MODES = ["muted", "original"] as const;

export type CreativeVibe = (typeof VIBES)[number];
export type CaptionStyle = (typeof CAPTION_STYLES)[number];
export type AudioMode = (typeof AUDIO_MODES)[number];
export type ShotOrder = [number, number, number];

export type CreativeOptions = {
  vibe: CreativeVibe;
  hook: string;
  captions: [string, string, string];
  captionStyle: CaptionStyle;
  shotOrder: ShotOrder;
  audioMode: AudioMode;
};

export function defaultCreativeOptions(preset: ReelPreset): CreativeOptions {
  return {
    vibe: preset.effect === "retro" ? "nostalgic" : preset.effect === "party" || preset.effect === "punch" ? "energetic" : "cinematic",
    hook: preset.title,
    captions: [...preset.captions],
    captionStyle: preset.effect === "retro" ? "retro" : preset.effect === "punch" || preset.effect === "party" ? "bold" : "cinematic",
    shotOrder: [0, 1, 2],
    audioMode: "muted",
  };
}

export function isCreativeVibe(value: unknown): value is CreativeVibe { return typeof value === "string" && (VIBES as readonly string[]).includes(value); }
export function isCaptionStyle(value: unknown): value is CaptionStyle { return typeof value === "string" && (CAPTION_STYLES as readonly string[]).includes(value); }
export function isAudioMode(value: unknown): value is AudioMode { return typeof value === "string" && (AUDIO_MODES as readonly string[]).includes(value); }
export function isShotOrder(value: unknown): value is ShotOrder {
  return Array.isArray(value) && value.length === 3 && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 2) && new Set(value).size === 3;
}

/** Text is limited before persisting and escaped again at the FFmpeg boundary. */
export function cleanCreativeText(value: unknown, fallback: string, maximum = 52): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
  return cleaned || fallback;
}

export function parseCreativeOptions(value: unknown, preset: ReelPreset): CreativeOptions {
  const defaults = defaultCreativeOptions(preset);
  if (typeof value !== "object" || value === null) return defaults;
  const input = value as Record<string, unknown>;
  const rawCaptions = Array.isArray(input.captions) ? input.captions : defaults.captions;
  return {
    vibe: isCreativeVibe(input.vibe) ? input.vibe : defaults.vibe,
    hook: cleanCreativeText(input.hook, defaults.hook),
    captions: [
      cleanCreativeText(rawCaptions[0], defaults.captions[0], 44),
      cleanCreativeText(rawCaptions[1], defaults.captions[1], 44),
      cleanCreativeText(rawCaptions[2], defaults.captions[2], 44),
    ],
    captionStyle: isCaptionStyle(input.captionStyle) ? input.captionStyle : defaults.captionStyle,
    shotOrder: isShotOrder(input.shotOrder) ? input.shotOrder : defaults.shotOrder,
    audioMode: isAudioMode(input.audioMode) ? input.audioMode : defaults.audioMode,
  };
}
