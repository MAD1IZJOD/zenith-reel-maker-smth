import type { ReelPreset } from "@/lib/presets";
import { getSoundtrack, type MusicId } from "./music";

export const SYNC_MODES = ["preset", "auto", "energetic", "cinematic", "custom"] as const;
export type SyncMode = typeof SYNC_MODES[number];
export type TimingOptions = { syncMode: SyncMode; musicId: MusicId; customSeconds: [number, number, number] };
export type EditTimeline = { clipDurations: [number, number, number]; cutPositions: [number, number]; totalDuration: number; transitionDuration: number; beats: number[]; bpm: number };

/** The very same timeline drives the visitor's ruler and FFmpeg offsets. */
export function createTimeline(preset: ReelPreset, options: TimingOptions): EditTimeline {
  const bpm = getSoundtrack(options.musicId)?.bpm || 120;
  const beatSeconds = 60 / bpm;
  const transitionDuration = preset.id === "movie-trailer" ? 0.65 : 0.35;
  let clipDurations: [number, number, number];
  if (options.syncMode === "preset") clipDurations = [preset.clipSeconds, preset.clipSeconds, preset.clipSeconds];
  else {
    const beatsPerShot = options.syncMode === "energetic" ? 2 : options.syncMode === "cinematic" ? 8 : 4;
    const segments = options.syncMode === "custom" ? options.customSeconds : [beatSeconds * beatsPerShot, beatSeconds * beatsPerShot, beatSeconds * beatsPerShot];
    clipDurations = [segments[0] + transitionDuration, segments[1] + transitionDuration, segments[2]];
  }
  const cutPositions: [number, number] = [clipDurations[0] - transitionDuration, clipDurations[0] + clipDurations[1] - transitionDuration * 2];
  const totalDuration = clipDurations.reduce((sum, duration) => sum + duration, 0) - transitionDuration * 2;
  const beats = Array.from({ length: Math.floor(totalDuration / beatSeconds) + 1 }, (_, index) => Number((index * beatSeconds).toFixed(4)));
  return { clipDurations, cutPositions, totalDuration, transitionDuration, beats, bpm };
}
