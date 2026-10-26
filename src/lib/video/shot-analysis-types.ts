export type ShotIssue = "short" | "low-resolution" | "landscape" | "dark" | "bright";
export type ShotAnalysis = {
  supported: boolean; technicalValidity: "valid"; duration: number; width: number; height: number;
  orientation: "portrait" | "landscape" | "square"; hasAudio: boolean;
  brightness?: number; sampledFrames: number; issues: ShotIssue[];
};
