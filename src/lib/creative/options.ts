import type { ReelPreset } from "@/lib/presets";
import { getSoundtrack, type MusicId } from "./music";
import { SYNC_MODES, type SyncMode } from "./timeline";
import { CAPTION_STYLES as EDIT_CAPTION_STYLES, EXPORT_PROFILES, GRADES, PACINGS, RECIPES, TITLE_STYLES, TRANSITION_FAMILIES, type CaptionStyleId, type ExportProfile, type Grade, type Pacing, type TitleStyle, type TransitionFamily } from "@/lib/edit/styles";

export const VIBES = ["cinematic", "funny", "energetic", "dramatic", "aesthetic", "nostalgic"] as const;
export const CAPTION_STYLES = EDIT_CAPTION_STYLES;
export const AUDIO_MODES = ["muted", "original", "soundtrack", "mix"] as const;
export const TYPOGRAPHY_STYLES = TITLE_STYLES;
export const CAPTION_MODES = ["cards", "speech"] as const;
export type TypographyStyle = TitleStyle;

export type CreativeVibe = (typeof VIBES)[number];
export type CaptionStyle = CaptionStyleId;
export type AudioMode = (typeof AUDIO_MODES)[number];
export type ShotOrder = [number, number, number];
export type CaptionMode = (typeof CAPTION_MODES)[number];

/** Earlier releases used four caption looks; drafts and API clients keep working through this mapping. */
const LEGACY_CAPTION_STYLES: Record<string, CaptionStyle> = { bold: "high-energy", retro: "minimal" };
const captionStyleOf = (value: unknown): CaptionStyle | undefined => typeof value !== "string" ? undefined : (CAPTION_STYLES as readonly string[]).includes(value) ? value as CaptionStyle : LEGACY_CAPTION_STYLES[value];

export type CreativeOptions = {
  vibe: CreativeVibe;
  hook: string;
  captions: [string, string, string];
  captionStyle: CaptionStyle;
  captionMode: CaptionMode;
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
  trimMode: "auto" | "manual";
  coverTitle: string;
  coverFrame: 0 | 1 | 2;
  grade: "auto" | Grade;
  transitionStyle: "auto" | TransitionFamily;
  pacing: "auto" | Pacing;
  motion: "auto" | "off";
  profile: ExportProfile;
  /** Informational: who proposed the current plan. It never changes rendering by itself. */
  planSource: "rules" | "qwen";
};

export function defaultCreativeOptions(preset: ReelPreset): CreativeOptions {
  const recipe = RECIPES[preset.id];
  return {
    vibe: preset.effect === "retro" ? "nostalgic" : preset.effect === "party" || preset.effect === "punch" ? "energetic" : "cinematic",
    hook: preset.title,
    captions: [...preset.captions],
    captionStyle: recipe.captionStyle,
    captionMode: "cards",
    shotOrder: [0, 1, 2],
    audioMode: "muted",
    musicId: "pulse",
    syncMode: "preset",
    customSeconds: [2, 2, 2],
    closingTitle: preset.title,
    typographyStyle: recipe.titleStyle,
    titleSeconds: 2.2,
    overlaysEnabled: true,
    trimStarts: [0, 0, 0],
    trimMode: "auto",
    coverTitle: "",
    coverFrame: 0,
    grade: "auto",
    transitionStyle: "auto",
    pacing: "auto",
    motion: "auto",
    profile: "fast",
    planSource: "rules",
  };
}

export function isCreativeVibe(value: unknown): value is CreativeVibe { return typeof value === "string" && (VIBES as readonly string[]).includes(value); }
export function isCaptionStyle(value: unknown): value is CaptionStyle { return captionStyleOf(value) !== undefined; }
export function isAudioMode(value: unknown): value is AudioMode { return typeof value === "string" && (AUDIO_MODES as readonly string[]).includes(value); }
export function isShotOrder(value: unknown): value is ShotOrder {
  return Array.isArray(value) && value.length === 3 && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 2) && new Set(value).size === 3;
}
const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T => typeof value === "string" && (values as readonly string[]).includes(value);

/** Text is limited before persisting and escaped again at the FFmpeg boundary. */
export function cleanCreativeText(value: unknown, fallback: string, maximum = 52): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
  return cleaned || fallback;
}
const isSeconds = (value: unknown, length: number, min: number, max: number) => Array.isArray(value) && value.length === length && value.every((n) => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max);

export function parseCreativeOptions(value: unknown, preset: ReelPreset): CreativeOptions {
  const defaults = defaultCreativeOptions(preset);
  if (typeof value !== "object" || value === null) return defaults;
  const input = value as Record<string, unknown>;
  const rawCaptions = Array.isArray(input.captions) ? input.captions : defaults.captions;
  const trimStarts = isSeconds(input.trimStarts, 3, 0, 179.5) ? input.trimStarts as [number, number, number] : defaults.trimStarts;
  return {
    vibe: isCreativeVibe(input.vibe) ? input.vibe : defaults.vibe,
    hook: cleanCreativeText(input.hook, defaults.hook),
    captions: [
      cleanCreativeText(rawCaptions[0], defaults.captions[0], 44),
      cleanCreativeText(rawCaptions[1], defaults.captions[1], 44),
      cleanCreativeText(rawCaptions[2], defaults.captions[2], 44),
    ],
    captionStyle: captionStyleOf(input.captionStyle) ?? defaults.captionStyle,
    captionMode: oneOf(CAPTION_MODES, input.captionMode) ? input.captionMode : defaults.captionMode,
    shotOrder: isShotOrder(input.shotOrder) ? input.shotOrder : defaults.shotOrder,
    audioMode: isAudioMode(input.audioMode) ? input.audioMode : defaults.audioMode,
    musicId: typeof input.musicId === "string" && getSoundtrack(input.musicId) ? input.musicId as MusicId : defaults.musicId,
    syncMode: (SYNC_MODES as readonly unknown[]).includes(input.syncMode) ? input.syncMode as SyncMode : defaults.syncMode,
    customSeconds: isSeconds(input.customSeconds, 3, 1, 6) ? input.customSeconds as [number, number, number] : defaults.customSeconds,
    closingTitle: cleanCreativeText(input.closingTitle, defaults.closingTitle),
    typographyStyle: oneOf(TYPOGRAPHY_STYLES, input.typographyStyle) ? input.typographyStyle : defaults.typographyStyle,
    titleSeconds: typeof input.titleSeconds === "number" && Number.isFinite(input.titleSeconds) && input.titleSeconds >= 1 && input.titleSeconds <= 4 ? input.titleSeconds : defaults.titleSeconds,
    overlaysEnabled: input.overlaysEnabled !== false,
    trimStarts,
    // Drafts saved before automatic trimming existed treat any non-zero start as a manual choice.
    trimMode: input.trimMode === "manual" || input.trimMode === "auto" ? input.trimMode : trimStarts.some((start) => start > 0) ? "manual" : "auto",
    coverTitle: cleanCreativeText(input.coverTitle, ""),
    coverFrame: input.coverFrame === 1 || input.coverFrame === 2 ? input.coverFrame : 0,
    grade: input.grade === "auto" || oneOf(GRADES, input.grade) ? input.grade : defaults.grade,
    transitionStyle: input.transitionStyle === "auto" || oneOf(TRANSITION_FAMILIES, input.transitionStyle) ? input.transitionStyle : defaults.transitionStyle,
    pacing: input.pacing === "auto" || oneOf(PACINGS, input.pacing) ? input.pacing : defaults.pacing,
    motion: input.motion === "off" ? "off" : "auto",
    profile: oneOf(EXPORT_PROFILES, input.profile) ? input.profile : defaults.profile,
    planSource: input.planSource === "qwen" ? "qwen" : "rules",
  };
}

/** Drafts recover with defaults, but submitted specifications reject malformed controls. */
export function validateCreativeInput(value: unknown): void {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid edit settings.");
  const input = value as Record<string, unknown>;
  const check = (field: string, valid: (value: unknown) => boolean, message: string) => { if (input[field] !== undefined && !valid(input[field])) throw new Error(message); };
  check("audioMode", isAudioMode, "Choose an available audio mode.");
  check("musicId", (v) => typeof v === "string" && Boolean(getSoundtrack(v)), "Choose an available soundtrack.");
  check("syncMode", (v) => (SYNC_MODES as readonly unknown[]).includes(v), "Choose an available timing mode.");
  check("customSeconds", (v) => isSeconds(v, 3, 1, 6), "Set each shot segment between 1 and 6 seconds.");
  check("shotOrder", isShotOrder, "Include each shot exactly once.");
  check("captionStyle", isCaptionStyle, "Choose an available caption style.");
  check("captionMode", (v) => oneOf(CAPTION_MODES, v), "Choose title cards or speech captions.");
  check("typographyStyle", (v) => oneOf(TYPOGRAPHY_STYLES, v), "Choose an available typography style.");
  check("titleSeconds", (v) => typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 4, "Show the opening title for 1 to 4 seconds.");
  check("overlaysEnabled", (v) => typeof v === "boolean", "Invalid caption visibility.");
  check("coverFrame", (v) => [0, 1, 2].includes(v as number), "Choose one of the three cover frames.");
  check("trimStarts", (v) => isSeconds(v, 3, 0, 179.5), "Invalid shot trim points.");
  check("trimMode", (v) => v === "auto" || v === "manual", "Invalid trim mode.");
  check("grade", (v) => v === "auto" || oneOf(GRADES, v), "Choose an available colour look.");
  check("transitionStyle", (v) => v === "auto" || oneOf(TRANSITION_FAMILIES, v), "Choose an available transition style.");
  check("pacing", (v) => v === "auto" || oneOf(PACINGS, v), "Choose an available pacing.");
  check("motion", (v) => v === "auto" || v === "off", "Invalid camera motion setting.");
  check("profile", (v) => oneOf(EXPORT_PROFILES, v), "Choose Fast or Quality export.");
  check("planSource", (v) => v === "rules" || v === "qwen", "Invalid plan source.");
  for (const field of ["hook", "closingTitle", "coverTitle"]) if (input[field] !== undefined && typeof input[field] !== "string") throw new Error("Titles must be text.");
  if (input.captions !== undefined && (!Array.isArray(input.captions) || input.captions.length !== 3 || !input.captions.every((text) => typeof text === "string"))) throw new Error("Provide text for each of the three captions.");
}
