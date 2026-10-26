import type { ReelPreset } from "@/lib/presets";
import { getSoundtrack, type MusicId } from "./music";
import { SYNC_MODES, type SyncMode } from "./timeline";

export const VIBES = ["cinematic", "funny", "energetic", "dramatic", "aesthetic", "nostalgic"] as const;
export const CAPTION_STYLES = ["minimal", "cinematic", "bold", "retro"] as const;
export const AUDIO_MODES = ["muted", "original", "soundtrack"] as const;
export const TYPOGRAPHY_STYLES = ["editorial", "poster", "compact"] as const;
export type TypographyStyle = typeof TYPOGRAPHY_STYLES[number];

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
  musicId: MusicId;
  syncMode: SyncMode;
  customSeconds: [number, number, number];
  closingTitle: string;
  typographyStyle: TypographyStyle;
  titleSeconds: number;
  overlaysEnabled: boolean;
  trimStarts: [number, number, number];
  coverTitle: string;
  coverFrame: 0 | 1 | 2;
};

export function defaultCreativeOptions(preset: ReelPreset): CreativeOptions {
  return {
    vibe: preset.effect === "retro" ? "nostalgic" : preset.effect === "party" || preset.effect === "punch" ? "energetic" : "cinematic",
    hook: preset.title,
    captions: [...preset.captions],
    captionStyle: preset.effect === "retro" ? "retro" : preset.effect === "punch" || preset.effect === "party" ? "bold" : "cinematic",
    shotOrder: [0, 1, 2],
    audioMode: "muted",
    musicId: "pulse",
    syncMode: "preset",
    customSeconds: [2, 2, 2],
    closingTitle: preset.title,
    typographyStyle: "editorial",
    titleSeconds: 2.5,
    overlaysEnabled: true,
    trimStarts: [0, 0, 0],
    coverTitle: "",
    coverFrame: 0,
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
    musicId: typeof input.musicId === "string" && getSoundtrack(input.musicId) ? input.musicId as MusicId : defaults.musicId,
    syncMode: (SYNC_MODES as readonly unknown[]).includes(input.syncMode) ? input.syncMode as SyncMode : defaults.syncMode,
    customSeconds: Array.isArray(input.customSeconds) && input.customSeconds.length === 3 && input.customSeconds.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 1 && n <= 6) ? input.customSeconds as [number, number, number] : defaults.customSeconds,
    closingTitle: cleanCreativeText(input.closingTitle, defaults.closingTitle),
    typographyStyle: (TYPOGRAPHY_STYLES as readonly unknown[]).includes(input.typographyStyle) ? input.typographyStyle as TypographyStyle : defaults.typographyStyle,
    titleSeconds: typeof input.titleSeconds === "number" && Number.isFinite(input.titleSeconds) && input.titleSeconds >= 1 && input.titleSeconds <= 4 ? input.titleSeconds : defaults.titleSeconds,
    overlaysEnabled: input.overlaysEnabled !== false,
    trimStarts: Array.isArray(input.trimStarts) && input.trimStarts.length === 3 && input.trimStarts.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 179.5) ? input.trimStarts as [number, number, number] : defaults.trimStarts,
    coverTitle: cleanCreativeText(input.coverTitle, ""),
    coverFrame: input.coverFrame === 1 || input.coverFrame === 2 ? input.coverFrame : 0,
  };
}

/** Drafts recover with defaults, but submitted specifications reject malformed controls. */
export function validateCreativeInput(value: unknown): void {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid edit settings.");
  const input = value as Record<string, unknown>;
  if (input.audioMode !== undefined && !isAudioMode(input.audioMode)) throw new Error("Choose an available audio mode.");
  if (input.musicId !== undefined && (typeof input.musicId !== "string" || !getSoundtrack(input.musicId))) throw new Error("Choose an available soundtrack.");
  if (input.syncMode !== undefined && !(SYNC_MODES as readonly unknown[]).includes(input.syncMode)) throw new Error("Choose an available timing mode.");
  if (input.customSeconds !== undefined && (!Array.isArray(input.customSeconds) || input.customSeconds.length !== 3 || !input.customSeconds.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 1 && n <= 6))) throw new Error("Set each shot segment between 1 and 6 seconds.");
  if (input.shotOrder !== undefined && !isShotOrder(input.shotOrder)) throw new Error("Include each shot exactly once.");
  if (input.captionStyle !== undefined && !isCaptionStyle(input.captionStyle)) throw new Error("Choose an available caption style.");
  if (input.typographyStyle !== undefined && !(TYPOGRAPHY_STYLES as readonly unknown[]).includes(input.typographyStyle)) throw new Error("Choose an available typography style.");
  if (input.titleSeconds !== undefined && (typeof input.titleSeconds !== "number" || !Number.isFinite(input.titleSeconds) || input.titleSeconds < 1 || input.titleSeconds > 4)) throw new Error("Show the opening title for 1 to 4 seconds.");
  if (input.overlaysEnabled !== undefined && typeof input.overlaysEnabled !== "boolean") throw new Error("Invalid caption visibility.");
  if (input.coverFrame !== undefined && ![0, 1, 2].includes(input.coverFrame as number)) throw new Error("Choose one of the three cover frames.");
  if (input.trimStarts !== undefined && (!Array.isArray(input.trimStarts) || input.trimStarts.length !== 3 || !input.trimStarts.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 179.5))) throw new Error("Invalid shot trim points.");
  for (const field of ["hook", "closingTitle", "coverTitle"]) if (input[field] !== undefined && typeof input[field] !== "string") throw new Error("Titles must be text.");
  if (input.captions !== undefined && (!Array.isArray(input.captions) || input.captions.length !== 3 || !input.captions.every((text) => typeof text === "string"))) throw new Error("Provide text for each of the three captions.");
}
