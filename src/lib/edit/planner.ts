import type { ReelPreset } from "@/lib/presets";
import type { CreativeOptions } from "@/lib/creative/options";
import { createTimeline } from "@/lib/creative/timeline";
import type { ShotActivity } from "@/lib/video/shot-analysis-types";
import { groupWords, type TimedWord } from "@/lib/captions/grouping";
import { EDL_VERSION, parseEdl, type EditDecisionList, type EdlInput } from "./edl";
import { RECIPES, TRANSITION_SECONDS, type CaptionStyleId, type CropMode, type ExportProfile, type TitleStyle } from "./styles";

export type PlannerClip = { duration: number; width: number; height: number; hasAudio: boolean; activity?: ShotActivity };
export const CANVAS: Record<ExportProfile, { width: 720 | 1080; height: 1280 | 1920; fps: 30 }> = { fast: { width: 720, height: 1280, fps: 30 }, quality: { width: 1080, height: 1920, fps: 30 } };
const round = (value: number) => Math.round(value * 1000) / 1000;
const SPEECH_DB = -32;

/** Portrait sources fill the frame; landscape and square sources sit on a soft blurred fill instead of black bars. */
export const cropFor = (clip: Pick<PlannerClip, "width" | "height">): CropMode => (clip.width / clip.height > 0.75 ? "fit-blur" : "cover");

/**
 * Chooses where a segment starts inside its source. With measured activity it prefers the window with the most
 * on-screen movement (and speech when original sound is used), avoids starting or ending mid-word, skips the
 * shaky first fifth of a second and slightly favours earlier starts. Without measurements it keeps the start.
 */
export function chooseStart(clip: PlannerClip, need: number, useSpeech: boolean): number {
  const slack = clip.duration - need;
  if (slack <= 0.05) return 0;
  const lead = Math.min(0.2, slack / 2);
  const activity = clip.activity;
  if (!activity || activity.motion.length < 3) return round(lead);
  const step = activity.step;
  const motion = activity.motion.slice(1);
  const peak = Math.max(1, ...motion);
  const at = (series: number[], time: number) => series[Math.max(0, Math.min(series.length - 1, Math.round(time / step)))];
  const loud = (time: number) => useSpeech && activity.audio.length > 0 && at(activity.audio, time) > SPEECH_DB;
  let best = { start: lead, score: -Infinity };
  for (let start = lead; start <= slack - 0.05 + 1e-9; start += step) {
    const from = Math.round(start / step), to = Math.max(from + 1, Math.round((start + need) / step));
    const window = activity.motion.slice(from, to);
    let score = window.reduce((sum, value) => sum + value, 0) / window.length / peak;
    if (useSpeech && activity.audio.length) {
      const speech = activity.audio.slice(from, to);
      score += 0.6 * speech.filter((value) => value > SPEECH_DB).length / Math.max(1, speech.length);
      if (loud(start) && loud(start - step)) score -= 0.35;
      if (loud(start + need) && loud(start + need + step)) score -= 0.35;
    }
    score -= 0.015 * start;
    if (score > best.score + 0.02) best = { start, score };
  }
  return round(best.start);
}

/** Maps source-time word timestamps onto the output timeline for one segment. Times are never invented. */
function mapWords(words: TimedWord[], sourceStart: number, speed: number, outputStart: number, visible: [number, number]): TimedWord[] {
  return words.map((word) => ({ text: word.text, start: round(outputStart + (word.start - sourceStart) / speed), end: round(outputStart + (word.end - sourceStart) / speed) }))
    .filter((word) => word.start >= visible[0] - 0.02 && word.end <= visible[1] + 0.02 && word.end > word.start);
}

function captionGroups(words: TimedWord[], style: CaptionStyleId, total: number) {
  return groupWords(words, style).map((group) => ({ start: round(Math.max(0, group.start)), end: round(Math.min(total, group.end)), words: group.words.map((word) => ({ text: word.text, start: round(Math.max(0, word.start)), end: round(Math.min(total, word.end)) })) }))
    .filter((group) => group.end > group.start);
}

export type ClipPlanInput = { preset: ReelPreset; options: CreativeOptions; title?: string; clips: PlannerClip[]; transcripts?: (TimedWord[] | undefined)[] };

/** Deterministic: identical inputs always produce the identical Edit Decision List. */
export function planClipEdit({ preset, options, title, clips, transcripts }: ClipPlanInput): EditDecisionList {
  const recipe = RECIPES[preset.id];
  const timeline = createTimeline(preset, options);
  const total = timeline.totalDuration;
  const anyAudio = clips.some((clip) => clip.hasAudio);
  const mode = options.audioMode === "original" && !anyAudio ? "muted" : options.audioMode === "mix" && !anyAudio ? "soundtrack" : options.audioMode;
  const useOriginal = mode === "original" || mode === "mix";
  const visible: [number, number][] = [0, 1, 2].map((index) => [index === 0 ? 0 : timeline.cutPositions[index - 1] + timeline.transitionSeconds[index - 1], index === 2 ? total : timeline.cutPositions[index]]);
  const outputStarts = [0, timeline.cutPositions[0], timeline.cutPositions[1]];

  const segments = options.shotOrder.map((source, position) => {
    const clip = clips[source];
    const duration = timeline.clipDurations[position];
    const start = options.trimMode === "manual" ? Math.min(options.trimStarts[source], Math.max(0, clip.duration - 0.5)) : chooseStart(clip, duration, useOriginal && clip.hasAudio);
    const available = clip.duration - start;
    // Speech must keep its natural pitch and rhythm, so only silent footage is gently slowed to fill a beat.
    const speed = available >= duration || (useOriginal && clip.hasAudio) ? 1 : Math.max(0.75, round(available / duration));
    const lowResolution = Math.min(clip.width, clip.height) < 480;
    return { source, start: round(start), duration: round(duration), speed, crop: cropFor(clip), focusX: 0.5, motion: options.motion === "off" || lowResolution ? "none" as const : recipe.motion[position] };
  });

  const hookEnd = round(Math.max(1, Math.min(options.titleSeconds, total - 2.2)));
  const closingLength = Math.min(1.6, (total - timeline.cutPositions[1]) - 0.3);
  const closingStart = round(Math.max(hookEnd + 0.4, total - closingLength));
  const hasClosing = total - closingStart >= 0.7;
  const overlays: EdlInput["overlays"] = [{ role: "hook", text: options.hook || title || preset.title, start: 0.08, end: hookEnd }];
  if (hasClosing) overlays.push({ role: "closing", text: options.closingTitle || title || preset.title, start: closingStart, end: round(total) });

  let captions: EdlInput["captions"] = [];
  if (options.captionMode === "speech" && useOriginal && transcripts?.some((words) => words?.length)) {
    const words = segments.flatMap((segment, position) => mapWords(transcripts[segment.source] || [], segment.start, segment.speed, outputStarts[position], visible[position]));
    captions = captionGroups(words, options.captionStyle, total);
  } else if (options.overlaysEnabled) {
    segments.forEach((segment, position) => {
      const start = round(Math.max(visible[position][0] + 0.2, position === 0 ? hookEnd + 0.1 : 0));
      const end = round(position === 2 ? (hasClosing ? closingStart - 0.1 : total - 0.1) : visible[position][1] - 0.05);
      if (end - start >= 0.7) overlays.push({ role: "card", text: options.captions[segment.source], start, end });
    });
  }
  if (recipe.overlay === "camcorder") overlays.push({ role: "badge", text: "REC", start: 0, end: round(total) });

  const coverTimes = [Math.min(1, timeline.cutPositions[0] * 0.5), (timeline.cutPositions[0] + timeline.cutPositions[1]) / 2, total - 0.5].map(round);
  const edl: EdlInput = {
    version: EDL_VERSION, presetId: preset.id, profile: options.profile, canvas: CANVAS[options.profile],
    sources: clips.map(({ duration, width, height, hasAudio }) => ({ duration, width, height, hasAudio })),
    segments, transitions: timeline.transitions.map((type, index) => ({ type, duration: timeline.transitionSeconds[index] })),
    grade: options.grade === "auto" ? recipe.grade : options.grade,
    titleStyle: options.typographyStyle, captionStyle: options.captionStyle, overlays, captions,
    accents: timeline.transitions.flatMap((type, index) => (type === "flash" ? [round(timeline.cutPositions[index])] : [])),
    frameOverlay: recipe.overlay === "camcorder" ? "camcorder" : "none",
    audio: { mode, musicId: mode === "soundtrack" || mode === "mix" ? options.musicId : undefined, musicGain: mode === "mix" ? 0.32 : 0.85, duck: mode === "mix", fadeIn: mode === "soundtrack" || mode === "mix" ? 0.25 : 0.08, fadeOut: 0.5, loudness: -14 },
    cover: { times: coverTimes, selected: options.coverFrame, title: options.coverTitle || title || options.hook || preset.title },
  };
  return parseEdl(edl);
}

export type HighlightPlanInput = {
  presetId?: string; source: PlannerClip; start: number; end: number; words: TimedWord[];
  hook: string; captionStyle: CaptionStyleId; titleStyle?: TitleStyle; profile: ExportProfile;
  grade?: EditDecisionList["grade"]; music?: { musicId: "pulse" | "drift"; gain?: number };
};

/**
 * A single continuous highlight from a long source (podcast, talk, interview) with word-timed captions.
 * This is the Stage 2 building block: the three-reel workflow chooses windows; this turns one into an edit.
 */
export function planHighlightEdit(input: HighlightPlanInput): EditDecisionList {
  const duration = round(input.end - input.start);
  const words = input.words.filter((word) => word.start >= input.start - 0.01 && word.end <= input.end + 0.01).map((word) => ({ text: word.text, start: round(word.start - input.start), end: round(word.end - input.start) }));
  const hookEnd = round(Math.min(2.6, duration / 3));
  const mode = input.source.hasAudio ? (input.music ? "mix" : "original") : input.music ? "soundtrack" : "muted";
  return parseEdl({
    version: EDL_VERSION, presetId: input.presetId || "highlight", profile: input.profile, canvas: CANVAS[input.profile],
    sources: [{ duration: input.source.duration, width: input.source.width, height: input.source.height, hasAudio: input.source.hasAudio }],
    segments: [{ source: 0, start: round(input.start), duration, speed: 1, crop: cropFor(input.source), focusX: 0.5, motion: duration > 12 ? "none" : "push-in" }],
    transitions: [], grade: input.grade || "clean-neutral", titleStyle: input.titleStyle || "poster", captionStyle: input.captionStyle,
    overlays: [{ role: "hook", text: input.hook, start: 0.05, end: hookEnd }],
    captions: captionGroups(words, input.captionStyle, duration),
    audio: { mode, musicId: input.music?.musicId, musicGain: input.music?.gain ?? 0.22, duck: mode === "mix", fadeIn: 0.1, fadeOut: 0.6, loudness: -14 },
    cover: { times: [round(Math.min(1, duration * 0.1)), round(duration * 0.5), round(duration - 0.5)], selected: 0, title: input.hook },
  });
}
