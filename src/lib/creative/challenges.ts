import type { ReelJob } from "@/lib/jobs/queue";
import { getPreset, type PresetId } from "@/lib/presets";
export type Challenge = { id: string; title: string; description: string; presetId: PresetId; difficulty: "Easy" | "Medium"; shots: [string, string, string]; requirements: string; completion: string };
const completion = "Complete three valid clips and export a reel. Suggested style adds 20 points; custom title adds 10. Filming content is not automatically judged.";
export const CHALLENGES: Challenge[] = [
  { id: "entrance", title: "Dramatic Entrance", description: "Build a confident arrival in three moments.", presetId: "main-character", difficulty: "Easy", shots: ["Walk into a safe, clear frame", "Pause for one confident detail", "Reveal your festival destination"], requirements: "One arrival, one detail, one reveal. Walk; no running or stunts.", completion },
  { id: "squad-sync", title: "Perfect Squad Sync", description: "Match one simple move with your friends.", presetId: "squad-montage", difficulty: "Medium", shots: ["First friend makes a simple hand gesture", "Second friend repeats the gesture", "Everyone repeats it together"], requirements: "Ask everyone before filming. Keep the move simple.", completion },
  { id: "transformation", title: "Epic Transformation", description: "A before, a transition and a bright after.", presetId: "glow-up", difficulty: "Easy", shots: ["Show the before", "Cover the lens with your hand", "Reveal your changed outfit or setting"], requirements: "A clear before and after; no risky transformations.", completion },
  { id: "twist", title: "Unexpected Plot Twist", description: "Set up an expectation, then change the ending.", presetId: "plot-twist", difficulty: "Medium", shots: ["Set up a harmless expectation", "Pause and react to something off-screen", "Reveal the funny surprise"], requirements: "Keep the surprise kind and consensual.", completion },
  { id: "silent", title: "Silent Storytelling", description: "Tell a tiny story without spoken words.", presetId: "beat-sync", difficulty: "Medium", shots: ["Show a character wanting something", "Show the small obstacle", "Show the happy solution"], requirements: "Use gestures and captions. No spoken audio needed.", completion },
  { id: "trailer", title: "Trailer Challenge", description: "Make an everyday moment feel cinematic.", presetId: "movie-trailer", difficulty: "Medium", shots: ["Hold a wide atmospheric opening", "Frame one mysterious detail", "Reveal your everyday hero"], requirements: "Stable shots and a dramatic final reveal.", completion },
  { id: "memories", title: "Retro Memories", description: "Capture a festival memory worth keeping.", presetId: "retro-cam", difficulty: "Easy", shots: ["Show the festival space", "Capture a small candid detail with permission", "End on a friendly wave"], requirements: "Ask before filming other people.", completion },
];
export const getChallenge = (id?: string) => CHALLENGES.find((item) => item.id === id);
export function challengeResult(job: ReelJob) {
  const challenge = getChallenge(job.challengeId);
  if (!challenge || job.stage !== "completed") return undefined;
  const criteria = [
    { label: "Three validated clips", points: 30, met: true },
    { label: "Successful export", points: 40, met: true },
    { label: "Suggested preset", points: 20, met: job.presetId === challenge.presetId },
    { label: "Custom title", points: 10, met: Boolean(job.title?.trim() && job.title.trim() !== getPreset(job.presetId)?.title) },
  ];
  return { challenge: challenge.title, challengeId: challenge.id, score: criteria.reduce((sum, criterion) => sum + (criterion.met ? criterion.points : 0), 0), criteria, note: "Completion points, not a video quality or virality rating. Camera and uploads earn the same points." };
}
