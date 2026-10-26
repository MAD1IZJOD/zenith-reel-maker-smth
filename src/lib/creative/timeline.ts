import type { ReelPreset } from "@/lib/presets";
import { getSoundtrack, type MusicId } from "./music";
import { FAMILY_TRANSITIONS, PACING_SCALE, RECIPES, TRANSITION_SECONDS, type Pacing, type Transition, type TransitionFamily } from "@/lib/edit/styles";

export const SYNC_MODES = ["preset", "auto", "energetic", "cinematic", "custom"] as const;
export type SyncMode = typeof SYNC_MODES[number];
export type TimingOptions = { syncMode: SyncMode; musicId: MusicId; customSeconds: [number, number, number]; transitionStyle?: "auto" | TransitionFamily; pacing?: "auto" | Pacing };
export type EditTimeline = { clipDurations: [number, number, number]; cutPositions: [number, number]; totalDuration: number; transitionDuration: number; transitions: [Transition, Transition]; transitionSeconds: [number, number]; beats: number[]; bpm: number };

export function transitionsFor(preset: ReelPreset, style: TimingOptions["transitionStyle"] = "auto"): [Transition, Transition] {
  return !style || style === "auto" ? RECIPES[preset.id].transitions : FAMILY_TRANSITIONS[style];
}

/**
 * The very same timeline drives the visitor's ruler and the Edit Decision List. Beats are the visible time
 * between cuts; a crossfading transition borrows its overlap from the outgoing clip so cuts land on the grid.
 */
export function createTimeline(preset: ReelPreset, options: TimingOptions): EditTimeline {
  const bpm = getSoundtrack(options.musicId)?.bpm || 120;
  const beatSeconds = 60 / bpm;
  const transitions = transitionsFor(preset, options.transitionStyle);
  const transitionSeconds = transitions.map((type) => TRANSITION_SECONDS[type]) as [number, number];
  let beatsBetweenCuts: [number, number, number];
  if (options.syncMode === "preset") {
    const scale = !options.pacing || options.pacing === "auto" ? 1 : PACING_SCALE[options.pacing];
    beatsBetweenCuts = RECIPES[preset.id].beats.map((value) => Math.round(value * scale * 10) / 10) as [number, number, number];
  } else if (options.syncMode === "custom") beatsBetweenCuts = [...options.customSeconds];
  else {
    const perShot = options.syncMode === "energetic" ? 2 : options.syncMode === "cinematic" ? 8 : 4;
    beatsBetweenCuts = [beatSeconds * perShot, beatSeconds * perShot, beatSeconds * perShot];
  }
  const clipDurations: [number, number, number] = [beatsBetweenCuts[0] + transitionSeconds[0], beatsBetweenCuts[1] + transitionSeconds[1], beatsBetweenCuts[2]];
  const cutPositions: [number, number] = [beatsBetweenCuts[0], beatsBetweenCuts[0] + beatsBetweenCuts[1]];
  const totalDuration = Number((beatsBetweenCuts[0] + beatsBetweenCuts[1] + beatsBetweenCuts[2]).toFixed(4));
  const beats = Array.from({ length: Math.floor(totalDuration / beatSeconds) + 1 }, (_, index) => Number((index * beatSeconds).toFixed(4)));
  return { clipDurations, cutPositions, totalDuration, transitionDuration: Math.max(...transitionSeconds), transitions, transitionSeconds, beats, bpm };
}
