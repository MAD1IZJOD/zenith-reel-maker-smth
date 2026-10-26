import { CheckCircle2, Sun } from "lucide-react";
import { shotSuggestions } from "@/lib/creative/shot-coach";
import type { ShotAnalysis } from "@/lib/video/shot-analysis-types";

export function ShotCoach({ analysis, recommendedSeconds }: { analysis?: ShotAnalysis; recommendedSeconds: number }) {
  if (!analysis) return null;
  const suggestions = shotSuggestions(analysis, recommendedSeconds);
  return <aside className="shot-coach" aria-label="Shot Coach assessment" role="status"><div>{suggestions.length ? <Sun size={18} /> : <CheckCircle2 size={18} />}<b>{suggestions.length ? "Shot saved. A small adjustment could help." : "Shot captured. Ready for your next moment."}</b></div>{suggestions.map((suggestion) => <p key={suggestion}>{suggestion}</p>)}<small>Checks: duration, source size{analysis.sampledFrames ? `, light in ${analysis.sampledFrames} sampled frames` : " · light check unavailable"}. Suggestions never block your edit.</small></aside>;
}
