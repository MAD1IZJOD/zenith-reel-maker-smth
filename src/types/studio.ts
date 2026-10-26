import type { ShotAnalysis } from "@/lib/video/shot-analysis-types";

export type StudioShot = { previewUrl: string; duration: number; name: string; analysis?: ShotAnalysis };
export type StudioJob = {
  id: string; presetId?: string; challengeId?: string; sourceId?: string;
  stage: "queued" | "validating" | "preparing" | "rendering" | "finalizing" | "completed" | "failed";
  error?: string; outputUrl?: string; coverUrl?: string; coverUrls?: string[];
  metrics?: { queueWaitMs?: number; planMs?: number; renderDurationMs?: number; encodeMs?: number; verifyMs?: number; totalMs?: number; completedAt?: number; outputDurationSeconds?: number; outputBytes?: number; width?: number; height?: number };
};
