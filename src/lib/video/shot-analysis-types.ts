export type ShotIssue = "short" | "low-resolution" | "landscape" | "dark" | "bright";
/** Measured activity sampled every `step` seconds: mean frame difference (0-255 luma) and RMS level in dBFS. */
export type ShotActivity = { step: number; motion: number[]; audio: number[] };
export type ShotAnalysis = {
  supported: boolean; technicalValidity: "valid"; duration: number; width: number; height: number;
  orientation: "portrait" | "landscape" | "square"; hasAudio: boolean;
  brightness?: number; sampledFrames: number; issues: ShotIssue[];
  activity?: ShotActivity;
};
