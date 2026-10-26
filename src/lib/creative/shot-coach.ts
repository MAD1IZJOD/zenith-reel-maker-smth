import type { ShotAnalysis } from "@/lib/video/shot-analysis-types";

export function shotSuggestions(analysis: ShotAnalysis, recommendedSeconds: number): string[] {
  const suggestions: string[] = [];
  if (analysis.duration < recommendedSeconds) suggestions.push(`This clip is shorter than the ${recommendedSeconds.toFixed(1)}s edit. We’ll hold its final frame; record longer for continuous movement.`);
  if (analysis.issues.includes("dark")) suggestions.push("Lighting looks low in the sampled frames. Try facing a brighter area.");
  if (analysis.issues.includes("bright")) suggestions.push("The sampled frames are very bright. Move away from direct light if details look washed out.");
  if (analysis.issues.includes("low-resolution")) suggestions.push("This clip has a small frame size. A higher-resolution recording will look clearer.");
  if (analysis.issues.includes("landscape")) suggestions.push("This is a landscape clip. We’ll preserve its shape with padding; film vertically to fill the reel.");
  return suggestions.slice(0, 2);
}
