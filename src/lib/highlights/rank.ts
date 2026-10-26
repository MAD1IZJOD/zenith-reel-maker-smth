import { z } from "zod";
import { creativeModel, ProviderError, type LocalModelProvider } from "@/lib/ai/provider";
import { cleanOverlayText } from "@/lib/edit/edl";
import { selectNonOverlapping, type HighlightCandidate } from "./candidates";

const rankingSchema = z.object({ rankings: z.array(z.object({ id: z.string().length(16), score: z.number().int().min(0).max(100), hook: z.string().min(2).max(60), topic: z.string().max(60), reason: z.string().max(200) })).min(1).max(8) });
const rankingJsonSchema = {
  type: "object", additionalProperties: false, required: ["rankings"],
  properties: { rankings: { type: "array", minItems: 1, maxItems: 8, items: { type: "object", additionalProperties: false, required: ["id", "score", "hook", "topic", "reason"], properties: { id: { type: "string" }, score: { type: "integer", minimum: 0, maximum: 100 }, hook: { type: "string", maxLength: 52 }, topic: { type: "string", maxLength: 40 }, reason: { type: "string", maxLength: 160 } } } } },
};

export type RankResult = { candidates: HighlightCandidate[]; rankedBy: "qwen" | "heuristic"; model?: string; latencyMs: number; fallbackReason?: string };

/**
 * Asks the local model to judge a short list of pre-filtered, non-overlapping windows from their transcript text.
 * Model scores only reorder trusted candidates (ids must match); timing always comes from the transcript.
 */
export async function rankCandidates(pool: HighlightCandidate[], count = 3, provider: LocalModelProvider = creativeModel()): Promise<RankResult> {
  const shortlist = selectNonOverlapping(pool, 8, 1);
  const heuristic = { candidates: selectNonOverlapping(shortlist, count), rankedBy: "heuristic" as const, latencyMs: 0 };
  if (!shortlist.length) return heuristic;
  try {
    const { value, latencyMs, model } = await provider.structured({
      name: "highlight_ranking", schema: rankingSchema, jsonSchema: rankingJsonSchema, maxTokens: 700, temperature: 0.2, timeoutMs: 60_000,
      messages: [
        { role: "system", content: "You pick the most compelling short clips from a podcast for vertical social video. Prefer self-contained moments with a clear hook, a single idea and a satisfying ending. Hooks are 3-8 words, faithful to what is said, no hashtags or emoji. Reply with JSON only." },
        { role: "user", content: JSON.stringify({ candidates: shortlist.map((candidate) => ({ id: candidate.id, seconds: Math.round(candidate.duration), text: candidate.transcript.slice(0, 700) })) }) },
      ],
    });
    const byId = new Map(shortlist.map((candidate) => [candidate.id, candidate]));
    const ranked = value.rankings.filter((item) => byId.has(item.id)).map((item) => ({
      ...byId.get(item.id)!, hook: cleanOverlayText(item.hook, 52) || byId.get(item.id)!.hook, topic: cleanOverlayText(item.topic, 40) || byId.get(item.id)!.topic,
      estimatedEngagement: Number((0.6 * item.score / 100 + 0.4 * byId.get(item.id)!.estimatedEngagement).toFixed(3)), rationale: `Model: ${cleanOverlayText(item.reason, 180)} (${byId.get(item.id)!.rationale})`.slice(0, 300), rankedBy: "qwen" as const,
    }));
    if (!ranked.length) throw new ProviderError("invalid-output", "Model ranking referenced no known candidates.");
    return { candidates: selectNonOverlapping(ranked, count), rankedBy: "qwen", model, latencyMs };
  } catch (error) {
    return { ...heuristic, fallbackReason: error instanceof ProviderError ? error.message : "Model ranking failed." };
  }
}
