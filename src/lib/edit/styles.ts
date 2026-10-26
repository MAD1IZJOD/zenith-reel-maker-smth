import type { PresetId } from "@/lib/presets";

/** Curated, trusted vocabulary. Planners (rules or Qwen) choose names; only this file maps names to FFmpeg. */
export const GRADES = ["clean-neutral", "warm-film", "cool-cinematic", "contrast-editorial", "soft-nostalgia", "bright-social"] as const;
export const TRANSITIONS = ["cut", "dissolve", "whip", "flash", "push"] as const;
export const MOTIONS = ["none", "push-in", "pull-out", "drift-left", "drift-right"] as const;
export const CROP_MODES = ["cover", "fit-blur"] as const;
export const CAPTION_STYLES = ["clean-creator", "cinematic", "high-energy", "minimal", "podcast-pop"] as const;
export const TITLE_STYLES = ["editorial", "poster", "compact"] as const;
export const TRANSITION_FAMILIES = ["smooth", "energetic", "minimal"] as const;
export const PACINGS = ["relaxed", "balanced", "punchy"] as const;
export const EXPORT_PROFILES = ["fast", "quality"] as const;

export type Grade = typeof GRADES[number];
export type Transition = typeof TRANSITIONS[number];
export type Motion = typeof MOTIONS[number];
export type CropMode = typeof CROP_MODES[number];
export type CaptionStyleId = typeof CAPTION_STYLES[number];
export type TitleStyle = typeof TITLE_STYLES[number];
export type TransitionFamily = typeof TRANSITION_FAMILIES[number];
export type Pacing = typeof PACINGS[number];
export type ExportProfile = typeof EXPORT_PROFILES[number];

export const GRADE_LABELS: Record<Grade, string> = {
  "clean-neutral": "Clean Neutral", "warm-film": "Warm Film", "cool-cinematic": "Cool Cinematic",
  "contrast-editorial": "Contrast Editorial", "soft-nostalgia": "Soft Nostalgia", "bright-social": "Bright Social",
};
export const CAPTION_LABELS: Record<CaptionStyleId, string> = {
  "clean-creator": "Clean Creator", cinematic: "Cinematic", "high-energy": "High Energy", minimal: "Minimal", "podcast-pop": "Podcast Pop",
};

/** Transition durations in seconds. A cut has none; whip and flash stay short so motion reads as intent. */
export const TRANSITION_SECONDS: Record<Transition, number> = { cut: 0, dissolve: 0.45, whip: 0.22, flash: 0, push: 0.32 };

/** Each preset's editorial recipe: how long each beat breathes, how beats join, and how the camera feels. */
export type StyleRecipe = {
  beats: [number, number, number];
  transitions: [Transition, Transition];
  motion: [Motion, Motion, Motion];
  grade: Grade;
  captionStyle: CaptionStyleId;
  titleStyle: TitleStyle;
  overlay?: "camcorder";
};

export const RECIPES: Record<PresetId, StyleRecipe> = {
  // Slow entrance, a quick close-up, then a longer final beat that lands the reveal.
  "main-character": { beats: [2.8, 2.0, 3.2], transitions: ["dissolve", "flash"], motion: ["push-in", "none", "push-in"], grade: "contrast-editorial", captionStyle: "clean-creator", titleStyle: "editorial" },
  // Two-beat cuts at 120 BPM with a flash on each downbeat.
  "beat-sync": { beats: [2.0, 2.0, 2.5], transitions: ["flash", "flash"], motion: ["push-in", "pull-out", "push-in"], grade: "bright-social", captionStyle: "high-energy", titleStyle: "poster" },
  // Short before, a fast move, then the after holds longest.
  "glow-up": { beats: [2.4, 1.6, 3.6], transitions: ["whip", "flash"], motion: ["none", "push-in", "pull-out"], grade: "bright-social", captionStyle: "clean-creator", titleStyle: "poster" },
  // Setup, a held suspicious pause that slowly pushes in, then the payoff.
  "plot-twist": { beats: [2.8, 2.6, 2.8], transitions: ["dissolve", "push"], motion: ["none", "push-in", "none"], grade: "contrast-editorial", captionStyle: "cinematic", titleStyle: "editorial" },
  // Relaxed, drifting memory with long soft dissolves.
  "retro-cam": { beats: [3.0, 2.8, 3.0], transitions: ["dissolve", "dissolve"], motion: ["drift-left", "drift-right", "pull-out"], grade: "soft-nostalgia", captionStyle: "minimal", titleStyle: "compact", overlay: "camcorder" },
  // Energetic arrivals joined by directional whips.
  "squad-montage": { beats: [2.2, 2.2, 3.0], transitions: ["whip", "whip"], motion: ["push-in", "push-in", "pull-out"], grade: "bright-social", captionStyle: "high-energy", titleStyle: "poster" },
  // Atmospheric opening, a tighter middle, then the longest hero reveal.
  "movie-trailer": { beats: [3.4, 2.2, 4.2], transitions: ["dissolve", "push"], motion: ["push-in", "drift-right", "push-in"], grade: "cool-cinematic", captionStyle: "cinematic", titleStyle: "poster" },
};

export const FAMILY_TRANSITIONS: Record<TransitionFamily, [Transition, Transition]> = { smooth: ["dissolve", "dissolve"], energetic: ["whip", "flash"], minimal: ["cut", "cut"] };
export const PACING_SCALE: Record<Pacing, number> = { relaxed: 1.15, balanced: 1, punchy: 0.82 };

/**
 * Restrained grades built from documented FFmpeg filters. Skin tones are protected by small temperature
 * mixes and gentle curves rather than channel swaps. Values were tuned on real footage contact sheets.
 */
export function gradeFilter(grade: Grade, quality: boolean): string {
  const grain = (amount: number) => (quality ? `,noise=alls=${amount}:allf=t` : "");
  switch (grade) {
    case "clean-neutral": return "eq=contrast=1.04:saturation=1.04,curves=all='0/0.01 0.5/0.5 1/0.99'";
    case "warm-film": return `colortemperature=temperature=5200:mix=0.35,curves=all='0/0.03 0.25/0.22 0.75/0.78 1/0.97',eq=saturation=0.95${grain(3)}`;
    case "cool-cinematic": return `colortemperature=temperature=7800:mix=0.32,curves=all='0/0.02 0.25/0.2 0.75/0.8 1/0.98',eq=saturation=0.86:contrast=1.04${grain(2)}`;
    case "contrast-editorial": return "curves=all='0/0 0.22/0.17 0.78/0.84 1/1',eq=saturation=0.9";
    case "soft-nostalgia": return `colortemperature=temperature=4800:mix=0.4,curves=all='0/0.07 0.5/0.52 1/0.93',eq=saturation=0.8${quality ? ",noise=alls=6:allf=t" : ",noise=alls=4:allf=t"}`;
    case "bright-social": return "eq=brightness=0.02:contrast=1.05:saturation=1.08,vibrance=intensity=0.12";
  }
}
