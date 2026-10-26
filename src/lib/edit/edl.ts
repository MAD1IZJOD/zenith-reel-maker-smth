import { z } from "zod";
import { CAPTION_STYLES, CROP_MODES, EXPORT_PROFILES, GRADES, MOTIONS, TITLE_STYLES, TRANSITIONS } from "./styles";
import { SOUNDTRACKS } from "@/lib/creative/music";

/**
 * The Edit Decision List is the single source of truth for an export. Planners produce it, the compiler
 * turns it into FFmpeg arguments, and the job stores it so the same edit can be regenerated exactly.
 * Every field is bounded: no free-form filter strings, paths or expressions can enter through here.
 */
export const EDL_VERSION = 1;
export const MAX_SEGMENTS = 16;
export const MAX_OUTPUT_SECONDS = 120;

/** Removes control characters and ASS override syntax so visitor or model text renders literally. */
export function cleanOverlayText(value: string, maximum: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[{}\\]/g, "").replace(/\s+/g, " ").trim().slice(0, maximum);
}
const text = (maximum: number) => z.string().transform((value) => cleanOverlayText(value, maximum)).pipe(z.string().min(1).max(maximum));
const seconds = (maximum: number) => z.number().finite().min(0).max(maximum);

export const sourceClipSchema = z.object({
  duration: z.number().finite().min(0.3).max(14_400),
  /** Audio-only sources (podcasts without video) have no frame size. */
  width: z.number().int().min(16).max(8192).optional(),
  height: z.number().int().min(16).max(8192).optional(),
  hasVideo: z.boolean().default(true),
  hasAudio: z.boolean(),
});
/** "video" frames the source footage; the others are faceless compositions that never need the speaker on screen. */
export const COMPOSITIONS = ["video", "minimal", "cinematic", "broll"] as const;
export type Composition = typeof COMPOSITIONS[number];

export const segmentSchema = z.object({
  source: z.number().int().min(0).max(MAX_SEGMENTS - 1),
  start: seconds(14_400),
  duration: z.number().finite().min(0.4).max(90),
  speed: z.number().finite().min(0.75).max(1.5).default(1),
  crop: z.enum([...CROP_MODES, "abstract"]),
  /** Horizontal crop centre for cover framing, 0 = left edge, 1 = right edge. */
  focusX: z.number().finite().min(0).max(1).default(0.5),
  /** Fit-blur only: the smallest share of the canvas height the sharp foreground fills; higher crops more of a wide source's sides. */
  fitHeight: z.number().finite().min(0.3).max(1).default(0.4),
  motion: z.enum(MOTIONS),
});

export const transitionSchema = z.object({ type: z.enum(TRANSITIONS), duration: z.number().finite().min(0).max(1) });

export const textOverlaySchema = z.object({
  role: z.enum(["hook", "card", "closing", "badge", "headline", "backdrop"]),
  text: text(60),
  start: seconds(MAX_OUTPUT_SECONDS),
  end: seconds(MAX_OUTPUT_SECONDS),
});

export const wordSchema = z.object({ text: text(40), start: seconds(MAX_OUTPUT_SECONDS), end: seconds(MAX_OUTPUT_SECONDS) });
export const captionGroupSchema = z.object({ start: seconds(MAX_OUTPUT_SECONDS), end: seconds(MAX_OUTPUT_SECONDS), words: z.array(wordSchema).min(1).max(8) });

export const audioPlanSchema = z.object({
  mode: z.enum(["muted", "original", "soundtrack", "mix"]),
  musicId: z.enum(SOUNDTRACKS.map((track) => track.id) as [string, ...string[]]).optional(),
  musicGain: z.number().finite().min(0).max(1).default(0.8),
  duck: z.boolean().default(false),
  fadeIn: z.number().finite().min(0).max(2).default(0.15),
  fadeOut: z.number().finite().min(0).max(3).default(0.45),
  loudness: z.number().finite().min(-23).max(-9).default(-14),
});

export const edlSchema = z.object({
  version: z.literal(EDL_VERSION),
  presetId: z.string().max(40),
  profile: z.enum(EXPORT_PROFILES),
  canvas: z.object({ width: z.union([z.literal(720), z.literal(1080)]), height: z.union([z.literal(1280), z.literal(1920)]), fps: z.literal(30) }),
  sources: z.array(sourceClipSchema).min(1).max(MAX_SEGMENTS),
  segments: z.array(segmentSchema).min(1).max(MAX_SEGMENTS),
  transitions: z.array(transitionSchema).max(MAX_SEGMENTS - 1),
  grade: z.enum(GRADES),
  titleStyle: z.enum(TITLE_STYLES),
  captionStyle: z.enum(CAPTION_STYLES),
  overlays: z.array(textOverlaySchema).max(12),
  captions: z.array(captionGroupSchema).max(400).default([]),
  /** Flash accents at output times, used for beat accents and flash cuts. */
  accents: z.array(seconds(MAX_OUTPUT_SECONDS)).max(32).default([]),
  frameOverlay: z.enum(["none", "camcorder"]).default("none"),
  composition: z.enum(COMPOSITIONS).default("video"),
  captionPosition: z.enum(["lower", "center"]).default("lower"),
  /** Visitor-provided b-roll pieces for the "broll" composition, laid end to end on the output timeline. */
  broll: z.array(z.object({ source: z.number().int().min(0).max(MAX_SEGMENTS - 1), start: seconds(14_400), duration: z.number().finite().min(1).max(30) })).max(24).default([]),
  waveform: z.boolean().default(false),
  progressBar: z.boolean().default(false),
  audio: audioPlanSchema,
  cover: z.object({ times: z.array(seconds(MAX_OUTPUT_SECONDS)).length(3), selected: z.union([z.literal(0), z.literal(1), z.literal(2)]), title: text(60) }),
}).superRefine((edl, context) => {
  const issue = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
  if (edl.transitions.length !== edl.segments.length - 1) issue("Each segment boundary needs exactly one transition.");
  if (edl.canvas.width * 16 !== edl.canvas.height * 9) issue("Canvas must be 9:16.");
  for (const [index, segment] of edl.segments.entries()) {
    const source = edl.sources[segment.source];
    if (!source) { issue(`Segment ${index + 1} references a missing source.`); continue; }
    if (segment.start > Math.max(0, source.duration - 0.3)) issue(`Segment ${index + 1} starts after its source ends.`);
    const usesFrames = edl.composition === "video" || (edl.composition === "cinematic" && segment.crop === "abstract");
    if (usesFrames && (!source.hasVideo || !source.width || !source.height)) issue(`Segment ${index + 1} needs video frames its source does not have.`);
  }
  for (const piece of edl.broll) {
    const source = edl.sources[piece.source];
    if (!source || !source.hasVideo || !source.width || !source.height) issue("B-roll must come from a video source.");
    else if (piece.start > Math.max(0, source.duration - 0.5)) issue("B-roll starts after its clip ends.");
  }
  if (edl.broll.length && edl.composition !== "broll") issue("B-roll pieces belong to the b-roll composition.");
  for (const [index, transition] of edl.transitions.entries()) {
    const shortest = Math.min(edl.segments[index]?.duration ?? 0, edl.segments[index + 1]?.duration ?? 0);
    if (transition.type === "cut" || transition.type === "flash" ? transition.duration !== 0 : transition.duration <= 0 || transition.duration > shortest / 2) issue(`Transition ${index + 1} has an invalid duration.`);
  }
  const total = edlDuration(edl);
  if (total > MAX_OUTPUT_SECONDS) issue(`Edit exceeds ${MAX_OUTPUT_SECONDS} seconds.`);
  for (const overlay of edl.overlays) if (overlay.end <= overlay.start || overlay.end > total + 0.01) issue("Text overlay timing is outside the edit.");
  let previousEnd = 0;
  for (const group of edl.captions) {
    if (group.end <= group.start || group.start < previousEnd - 0.001 || group.end > total + 0.01) issue("Caption groups must be ordered, non-overlapping and inside the edit.");
    for (const word of group.words) if (word.end < word.start || word.start < group.start - 0.001 || word.end > group.end + 0.001) issue("Caption word timing is outside its group.");
    previousEnd = group.end;
  }
  for (const time of [...edl.cover.times, ...edl.accents]) if (time > total) issue("Cover and accent times must fall inside the edit.");
});

export type EditDecisionList = z.infer<typeof edlSchema>;
export type EdlInput = z.input<typeof edlSchema>;
export type EdlSegment = z.infer<typeof segmentSchema>;
export type CaptionGroup = z.infer<typeof captionGroupSchema>;

export function edlDuration(edl: Pick<EditDecisionList, "segments" | "transitions">): number {
  return Number((edl.segments.reduce((sum, segment) => sum + segment.duration, 0) - edl.transitions.reduce((sum, transition) => sum + transition.duration, 0)).toFixed(3));
}

/** Output-timeline start of each segment (after earlier transitions overlap). */
export function segmentOffsets(edl: Pick<EditDecisionList, "segments" | "transitions">): number[] {
  const offsets: number[] = [];
  let cursor = 0;
  for (const [index, segment] of edl.segments.entries()) { offsets.push(Number(cursor.toFixed(3))); cursor += segment.duration - (edl.transitions[index]?.duration ?? 0); }
  return offsets;
}

export function parseEdl(value: unknown): EditDecisionList {
  const result = edlSchema.safeParse(value);
  if (!result.success) throw new Error(`Invalid edit plan: ${result.error.issues.slice(0, 3).map((issue) => issue.message).join("; ")}`);
  return result.data;
}
