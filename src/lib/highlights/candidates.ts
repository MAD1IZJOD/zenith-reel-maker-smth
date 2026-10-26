import { createHash } from "node:crypto";
import { z } from "zod";
import type { Transcript, TranscriptWord } from "@/lib/transcription/schema";
import type { CaptionStyleId } from "@/lib/edit/styles";
import { cleanOverlayText } from "@/lib/edit/edl";

/**
 * A possible short reel inside a long recording. `estimatedEngagement` is a transparent heuristic from
 * structure, pacing and wording; it is NOT a prediction of views or virality.
 */
export const highlightCandidateSchema = z.object({
  id: z.string().length(16),
  sourceId: z.string(),
  start: z.number().finite().min(0),
  end: z.number().finite().min(0),
  duration: z.number().finite().min(1).max(120),
  transcript: z.string().max(4000),
  hook: z.string().max(60),
  topic: z.string().max(60),
  completeness: z.number().min(0).max(1),
  estimatedEngagement: z.number().min(0).max(1),
  engagementBasis: z.literal("heuristic"),
  rationale: z.string().max(300),
  rankedBy: z.enum(["heuristic", "qwen"]),
  captionPlan: z.object({ style: z.string(), wordTimestamps: z.boolean(), words: z.number().int().min(0) }),
}).refine((candidate) => candidate.end > candidate.start && Math.abs(candidate.end - candidate.start - candidate.duration) < 0.01, "Candidate timing is inconsistent.");
export type HighlightCandidate = z.infer<typeof highlightCandidateSchema>;

export type Unit = { start: number; end: number; text: string; words: TranscriptWord[] };
export type WindowOptions = { minSeconds: number; maxSeconds: number; captionStyle: CaptionStyleId };
export const DEFAULT_WINDOW: WindowOptions = { minSeconds: 15, maxSeconds: 60, captionStyle: "podcast-pop" };

const TERMINAL = /[.!?…]["'”’)]*$/;
/** Sentence-level units. With word timestamps, sentences split at terminal punctuation; otherwise transcript segments are the units. */
export function sentenceUnits(transcript: Transcript): Unit[] {
  if (!transcript.wordTimestamps) return transcript.segments.filter((segment) => segment.text.trim()).map((segment) => ({ start: segment.start, end: segment.end, text: segment.text.trim(), words: [] }));
  const units: Unit[] = [];
  let current: TranscriptWord[] = [];
  const flush = () => { if (current.length) units.push({ start: current[0].start, end: current[current.length - 1].end, text: current.map((word) => word.text).join(" ").replace(/\s+([,.!?;:])/g, "$1"), words: current }); current = []; };
  for (const segment of transcript.segments) for (const word of segment.words || []) {
    const previous = current[current.length - 1];
    // A long pause ends a unit only when the next word plausibly starts a new sentence; otherwise fragments appear.
    if (previous && word.start - previous.end > 1.5 && /^[A-Z"“'‘]/.test(word.text.trim())) flush();
    current.push(word);
    if (TERMINAL.test(word.text.trim())) flush();
  }
  flush();
  return units;
}

const STOP = new Set("about above after again against because been before being below between both could doing during each from further have having here into itself just more most other ought ourselves over same should some such than that their theirs them themselves then there these they this those through under until very were what when where which while whom with would your yours yourself really thing things think going know like said says that's it's don't i'm you're we're they're actually basically right okay yeah".split(" "));
const CONNECTORS = /^(and|but|so|because|or|then|also|which|that)\b/i;
const HOOK_WORDS = /\b(why|how|what if|never|always|secret|mistake|truth|wrong|nobody|everyone|best|worst|biggest|first|only|stop|you)\b|\?|\d/i;

/** A short on-screen hook from the opening sentence, cut at a word boundary (never mid-word). */
export function hookFrom(sentence: string): string {
  const clean = cleanOverlayText(sentence, 200);
  if (clean.length <= 44) return clean;
  const words = clean.split(" ");
  let hook = "";
  for (const word of words) { if ((hook ? `${hook} ${word}` : word).length > 40) break; hook = hook ? `${hook} ${word}` : word; }
  return `${(hook || clean.slice(0, 40)).replace(/[,;:]$/, "")}…`;
}

function topicOf(text: string): string {
  const counts = new Map<string, number>();
  for (const raw of text.toLowerCase().match(/[a-z][a-z'-]{4,}/g) || []) if (!STOP.has(raw)) counts.set(raw, (counts.get(raw) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2).map(([word]) => word).join(" · ") || "conversation";
}

function score(units: Unit[], words: number, duration: number) {
  const first = units[0].text, last = units[units.length - 1].text;
  const completeness = Math.max(0, 1 - (CONNECTORS.test(first) ? 0.35 : 0) - (TERMINAL.test(last) ? 0 : 0.35) - (/^[a-z]/.test(first) ? 0.15 : 0));
  const rate = words / duration;
  const pacing = rate >= 1.8 && rate <= 3.6 ? 1 : Math.max(0, 1 - Math.min(Math.abs(rate - 1.8), Math.abs(rate - 3.6)) / 1.5);
  const speechCover = units.reduce((sum, unit) => sum + (unit.end - unit.start), 0) / duration;
  const hook = (HOOK_WORDS.test(first) ? 0.6 : 0.2) + (first.length <= 90 ? 0.4 : 0.15);
  const length = duration >= 20 && duration <= 45 ? 1 : 0.75;
  const engagement = 0.3 * hook + 0.25 * completeness + 0.2 * pacing + 0.15 * Math.min(1, speechCover) + 0.1 * length;
  const reasons = [hook >= 0.8 ? "opens with a question or strong claim" : "opens plainly", completeness >= 0.99 ? "complete sentences" : "may start or end mid-thought", `${rate.toFixed(1)} words/s`];
  return { completeness: Number(completeness.toFixed(3)), engagement: Number(Math.min(1, engagement).toFixed(3)), rationale: `Heuristic: ${reasons.join(", ")}.` };
}

/**
 * Every sentence-aligned window between the minimum and maximum duration. Boundaries fall between words,
 * padded into the surrounding silence but never into a neighbouring word.
 */
export function candidateWindows(sourceId: string, transcript: Transcript, options: WindowOptions = DEFAULT_WINDOW): HighlightCandidate[] {
  const units = sentenceUnits(transcript);
  const candidates: HighlightCandidate[] = [];
  for (let first = 0; first < units.length; first++) {
    for (let last = first; last < units.length; last++) {
      const speech = units[last].end - units[first].start;
      if (speech > options.maxSeconds) break;
      if (speech < options.minSeconds) continue;
      const before = first > 0 ? units[first - 1].end : 0, after = last + 1 < units.length ? units[last + 1].start : transcript.duration;
      const start = Number(Math.max(before, units[first].start - 0.2, 0).toFixed(3));
      const end = Number(Math.min(after, units[last].end + 0.4, transcript.duration).toFixed(3));
      const span = units.slice(first, last + 1);
      const words = span.reduce((sum, unit) => sum + (unit.words.length || unit.text.split(/\s+/).length), 0);
      const text = span.map((unit) => unit.text).join(" ");
      const result = score(span, words, end - start);
      candidates.push({
        id: createHash("sha256").update(`${sourceId}:${start}:${end}`).digest("hex").slice(0, 16), sourceId, start, end, duration: Number((end - start).toFixed(3)),
        transcript: text.slice(0, 4000), hook: hookFrom(span[0].text) || "Listen to this", topic: topicOf(text).slice(0, 60),
        completeness: result.completeness, estimatedEngagement: result.engagement, engagementBasis: "heuristic", rationale: result.rationale, rankedBy: "heuristic",
        captionPlan: { style: options.captionStyle, wordTimestamps: transcript.wordTimestamps, words },
      });
    }
  }
  return candidates;
}

/** True when neither boundary cuts through a spoken word and the window lies inside the media. */
export function validateCandidate(candidate: HighlightCandidate, transcript: Transcript, options: WindowOptions = DEFAULT_WINDOW): string[] {
  const problems: string[] = [];
  if (!highlightCandidateSchema.safeParse(candidate).success) problems.push("schema");
  if (candidate.start < 0 || candidate.end > transcript.duration + 0.01) problems.push("outside media");
  if (candidate.duration < options.minSeconds - 0.01 || candidate.duration > options.maxSeconds + 1) problems.push("duration");
  for (const word of transcript.segments.flatMap((segment) => segment.words || [])) {
    if (candidate.start > word.start + 0.01 && candidate.start < word.end - 0.01) problems.push("starts mid-word");
    if (candidate.end > word.start + 0.01 && candidate.end < word.end - 0.01) problems.push("ends mid-word");
  }
  return [...new Set(problems)];
}

/** Highest-scoring windows that do not overlap (with a small gap), returned in source order. */
export function selectNonOverlapping(candidates: HighlightCandidate[], count = 3, gapSeconds = 1): HighlightCandidate[] {
  const chosen: HighlightCandidate[] = [];
  for (const candidate of [...candidates].sort((a, b) => b.estimatedEngagement - a.estimatedEngagement || b.completeness - a.completeness || a.start - b.start)) {
    if (chosen.every((item) => candidate.end + gapSeconds <= item.start || candidate.start >= item.end + gapSeconds)) chosen.push(candidate);
    if (chosen.length === count) break;
  }
  return chosen.sort((a, b) => a.start - b.start);
}
