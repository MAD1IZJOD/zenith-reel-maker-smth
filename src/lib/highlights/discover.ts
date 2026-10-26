import { createHash } from "node:crypto";
import { z } from "zod";
import type { Transcript } from "@/lib/transcription/schema";
import { cleanOverlayText } from "@/lib/edit/edl";
import { creativeModel, ProviderError, type LocalModelProvider } from "@/lib/ai/provider";
import { hookFrom, sentenceUnits, type Unit } from "./candidates";

/**
 * Highlight discovery for long recordings. Candidate windows and their timestamps are always computed here from
 * the transcript; a local model may only rank existing candidate ids and phrase hooks that stay faithful to the
 * words spoken. Scores are editorial heuristics, never predictions of views or virality.
 */
export const LENGTH_PRESETS = { short: [15, 30], medium: [30, 45], long: [45, 60] } as const;
export const TONES = ["general", "educational", "motivational", "funny", "controversial", "storytelling", "business", "technology"] as const;
export type LengthPreset = keyof typeof LENGTH_PRESETS;
export type Tone = typeof TONES[number];
export type Preferences = { length: LengthPreset; tone: Tone };
export const ROLES = ["attention", "takeaway", "story", "highlight"] as const;
export type Role = typeof ROLES[number];
export const ROLE_LABELS: Record<Role, string> = { attention: "Most attention-grabbing", takeaway: "Strongest takeaway", story: "Best story moment", highlight: "Strong moment" };

export type Features = { hook: number; completeness: number; takeaway: number; story: number; emotion: number; tone: number; ending: number; density: number; emphasis: number; coherence: number; boilerplate: number };
export type Highlight = {
  id: string; sourceId: string; start: number; end: number; duration: number; transcript: string; words: number;
  hook: string; title: string; postCaption: string; hashtags: string[]; topic: string; role: Role;
  editorialScore: number; reasons: string[]; rankedBy: "heuristic" | "qwen"; features: Features;
};
export type Discovery = {
  preferences: Preferences; windows: number; pool: Highlight[]; selected: Highlight[]; notice?: string;
  rankedBy: "heuristic" | "qwen"; model?: string; modelLatencyMs: number; fallbackReason?: string; analysisMs: number;
};

const STOP = new Set("a an the and or but so if then than that this these those there here is are was were be been being to of in on at by for with as from into about over after before under again further once all any both each few more most other some such no nor not only own same too very can will just should now i me my we our you your he him his she her it its they them their what which who whom whose do does did doing have has had having would could i'm you're it's that's don't can't we're they're also really well yeah okay like know think going get got one thing things lot way".split(" "));
const tokens = (text: string) => (text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []).filter((word) => !STOP.has(word));
function cosine(a: Map<string, number>, b: Map<string, number>) {
  let dot = 0, na = 0, nb = 0;
  for (const [word, count] of a) { na += count * count; dot += count * (b.get(word) || 0); }
  for (const count of b.values()) nb += count * count;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
const bag = (texts: string[]) => { const counts = new Map<string, number>(); for (const word of texts.flatMap(tokens)) counts.set(word, (counts.get(word) || 0) + 1); return counts; };
const rate = (text: string, pattern: RegExp) => Math.min(1, (text.match(pattern) || []).length / 2);

const HOOK = /\b(why|how|what if|never|always|secret|mistake|truth|wrong|nobody|everyone|biggest|worst|best|most|only|stop|imagine|the problem|here's|you)\b|\?/gi;
const TAKEAWAY = /\b(you should|you need|you must|the key|remember|make sure|don't|do not|never|always|if you|how to|the way to|therefore|hence|that's why|which means|the lesson|the point is|rule)\b/gi;
const STORY = /\b(i remember|when i|one day|once|story|happened|we were|i was|years ago|back then|suddenly|later|at first|finally)\b/gi;
const EMOTION = /\b(love|hate|afraid|scared|crazy|amazing|incredible|terrible|beautiful|angry|laugh|funny|shocked|proud|painful)\b|!/gi;
/** Openings that continue a list ("Four, …", "5. …", "Secondly, …") depend on context the clip will not have. */
const ENUMERATION = /^(\d+[.)]?|(one|two|three|four|five|six|seven|eight|nine|ten|first(ly)?|second(ly)?|third(ly)?|fourth|fifth|next|lastly)[,.:])\s/i;
const CONTRAST = /\b(but|actually|however|instead|the truth is|in fact|yet)\b/gi;
const BOILERPLATE = /\b(subscribe|sponsor(ed)?|brought to you by|promo code|use code|patreon|link in|description below|librivox|public domain|this recording|this episode|welcome back|thanks for (listening|watching)|visit|www\.|dot com|follow us|newsletter)\b/gi;
const TONE_WORDS: Record<Tone, RegExp> = {
  general: /$^/g,
  educational: /\b(learn|explain|means|because|example|reason|understand|lesson|principle|rule|why)\b/gi,
  motivational: /\b(dream|goal|believe|success|fail(ure)?|discipline|courage|never give up|keep going|strength|win)\b/gi,
  funny: /\b(laugh|joke|funny|ridiculous|hilarious|silly|weird|absurd)\b/gi,
  controversial: /\b(disagree|wrong|myth|unpopular|actually|truth|nobody tells|overrated|mistake)\b/gi,
  storytelling: STORY,
  business: /\b(revenue|customer|market|startup|founder|sales|price|pricing|profit|company|business|growth|team)\b/gi,
  technology: /\b(ai|software|code|data|computer|app|internet|model|technology|machine|digital|algorithm)\b/gi,
};

/** Cohesion-based topic boundaries (TextTiling-style): strength in [0,1] for the gap after each unit. */
export function topicBoundaries(units: Unit[], span = 3): number[] {
  return units.map((unit, index) => {
    if (index === units.length - 1) return 1;
    const before = bag(units.slice(Math.max(0, index - span + 1), index + 1).map((item) => item.text));
    const after = bag(units.slice(index + 1, index + 1 + span).map((item) => item.text));
    const pause = units[index + 1].start - unit.end;
    return Math.min(1, (1 - cosine(before, after)) * 0.8 + Math.min(0.2, Math.max(0, pause - 0.6) / 5));
  });
}

/** Distinctive repeated words for topics and hashtags; adverbs and participles make poor tags. */
function keywords(text: string, count: number) {
  const counts = bag([text]);
  const usable = [...counts.entries()].filter(([word]) => word.length >= 4 && !/(ly|ed|ing|ous|ive|ible|able)$/.test(word));
  const repeated = usable.filter(([, value]) => value >= 2);
  return (repeated.length >= 2 ? repeated : usable).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0])).slice(0, count).map(([word]) => word);
}

/** Short, complete phrases spoken in the window: whole sentences and opening clauses of 3-9 words. */
function phrases(units: Unit[]): { text: string; position: number }[] {
  const out: { text: string; position: number }[] = [];
  units.forEach((unit, position) => {
    const sentence = cleanOverlayText(unit.text.replace(/[.…]+$/, ""), 160);
    const clauses = sentence.split(/[,;:—]/).map((part) => cleanOverlayText(part, 160)).filter(Boolean);
    for (const raw of new Set([sentence, ...clauses])) {
      const text = raw.replace(/^(thus|hence|therefore|now|again|and|but|so)\s+/i, "").replace(/^\w/, (letter) => letter.toUpperCase());
      const count = text.split(" ").length;
      if (count >= 4 && count <= 11 && text.length <= 60 && tokens(text).length >= 2 && !ENUMERATION.test(`${text} `)) out.push({ text, position });
    }
  });
  return out;
}
const phraseScore = (phrase: { text: string; position: number }) => rate(phrase.text, HOOK) + rate(phrase.text, TAKEAWAY) * 0.8 + rate(phrase.text, CONTRAST) * 0.3 - phrase.position * 0.05 + (/\?$/.test(phrase.text) ? 0.2 : 0);
/** Hook: the most hook-like complete phrase the speaker actually said, preferring early ones. */
function hookFromUnits(units: Unit[]): string {
  const best = phrases(units).sort((a, b) => phraseScore(b) - phraseScore(a) || a.text.length - b.text.length)[0];
  return best ? best.text : hookFrom(units[0].text);
}
/** Title: a substantive short phrase different from the hook; only the speaker's own words. */
function titleFrom(units: Unit[], hook: string): string {
  const options = phrases(units).filter((phrase) => phrase.text !== hook && !/\?$/.test(phrase.text)).sort((a, b) => tokens(b.text).length - tokens(a.text).length || rate(b.text, TAKEAWAY) - rate(a.text, TAKEAWAY) || a.position - b.position);
  return options[0]?.text || hook;
}

function features(units: Unit[], boundaries: number[], first: number, last: number, transcriptDuration: number, start: number, end: number, tone: Tone, emphasis: number): Features {
  const span = units.slice(first, last + 1);
  const text = span.map((unit) => unit.text).join(" ");
  const opening = span[0].text, closing = span[span.length - 1].text;
  const speech = span.reduce((sum, unit) => sum + (unit.end - unit.start), 0);
  const words = span.reduce((sum, unit) => sum + (unit.words.length || unit.text.split(/\s+/).length), 0);
  const perSecond = words / (end - start);
  const internal = boundaries.slice(first, last).reduce((max, value) => Math.max(max, value), 0);
  const nextPause = last + 1 < units.length ? units[last + 1].start - units[last].end : transcriptDuration - units[last].end;
  return {
    hook: Math.min(1, rate(opening, HOOK) * 0.6 + rate(opening, CONTRAST) * 0.2 + (opening.length <= 90 ? 0.25 : 0.05)),
    completeness: Math.max(0, 1 - (/^(and|but|so|because|or|then|also|which|that)\b/i.test(opening) ? 0.35 : 0) - (ENUMERATION.test(opening) ? 0.35 : 0) - (/^(thus|hence|therefore|this|these|it|they|he|she)\b/i.test(opening) ? 0.15 : 0) - (/[.!?…]["'”’)]*$/.test(closing.trim()) ? 0 : 0.35) - (/^[a-z]/.test(opening) ? 0.15 : 0) - (opening.split(/\s+/).length < 3 ? 0.3 : 0)),
    takeaway: rate(text, TAKEAWAY),
    story: rate(text, STORY),
    emotion: rate(text, EMOTION),
    tone: tone === "general" ? 0.5 : rate(text, TONE_WORDS[tone]),
    ending: Math.min(1, (/[.!?…]["'”’)]*$/.test(closing.trim()) ? 0.6 : 0) + Math.min(0.4, nextPause / 2)),
    density: Math.min(1, speech / (end - start)) * (perSecond >= 1.6 && perSecond <= 3.8 ? 1 : 0.7),
    emphasis,
    coherence: 1 - internal,
    boilerplate: Math.min(1, (text.match(BOILERPLATE) || []).length / 2),
  };
}

/** Transparent editorial rubric. Weights sum to 1; boilerplate (ads, intros, disclaimers) is subtracted. */
export function editorialScore(feature: Features): number {
  const value = 0.2 * feature.hook + 0.17 * feature.completeness + 0.12 * feature.takeaway + 0.08 * feature.story + 0.06 * feature.emotion + 0.1 * feature.tone + 0.1 * feature.ending + 0.07 * feature.density + 0.04 * feature.emphasis + 0.06 * feature.coherence - 0.6 * feature.boilerplate
    // A clip that straddles a clear change of topic rarely stands alone.
    - (feature.coherence < 0.15 ? 0.25 * (0.15 - feature.coherence) / 0.15 + 0.08 : 0);
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

function reasonsFor(feature: Features): string[] {
  const reasons: [number, string][] = [[feature.hook, "strong opening"], [feature.completeness, "complete thought"], [feature.takeaway, "clear takeaway"], [feature.story, "story moment"], [feature.emotion, "emotional language"], [feature.ending, "clean ending"], [feature.tone, "matches your chosen focus"]];
  return reasons.filter(([value]) => value >= 0.6).sort((a, b) => b[0] - a[0]).slice(0, 3).map(([, reason]) => reason);
}

/** Loudness variation inside a window relative to the whole recording (0..1), from a cached RMS profile. */
function emphasisOf(profile: { step: number; rms: number[] } | undefined, start: number, end: number): number {
  if (!profile || profile.rms.length < 4) return 0.5;
  const voiced = profile.rms.filter((value) => value > -50);
  if (!voiced.length) return 0.5;
  const median = [...voiced].sort((a, b) => a - b)[Math.floor(voiced.length / 2)];
  const window = profile.rms.slice(Math.floor(start / profile.step), Math.ceil(end / profile.step)).filter((value) => value > -50);
  if (!window.length) return 0;
  const peaks = window.filter((value) => value > median + 4).length / window.length;
  return Math.min(1, 0.4 + peaks * 2);
}

export function generateHighlights(sourceId: string, sourceLabel: string, transcript: Transcript, preferences: Preferences, profile?: { step: number; rms: number[] }): Highlight[] {
  const [minSeconds, maxSeconds] = LENGTH_PRESETS[preferences.length];
  const units = sentenceUnits(transcript);
  const boundaries = topicBoundaries(units);
  const results: Highlight[] = [];
  for (let first = 0; first < units.length; first++) {
    for (let last = first; last < units.length; last++) {
      const speech = units[last].end - units[first].start;
      if (speech > maxSeconds) break;
      if (speech < minSeconds) continue;
      const start = Number(Math.max(first > 0 ? units[first - 1].end : 0, units[first].start - 0.2, 0).toFixed(3));
      const end = Number(Math.min(last + 1 < units.length ? units[last + 1].start : transcript.duration, units[last].end + 0.45, transcript.duration).toFixed(3));
      const span = units.slice(first, last + 1);
      const speechCover = span.reduce((sum, unit) => sum + (unit.end - unit.start), 0) / (end - start);
      if (speechCover < 0.6) continue; // mostly silence or music
      const feature = features(units, boundaries, first, last, transcript.duration, start, end, preferences.tone, emphasisOf(profile, start, end));
      const text = span.map((unit) => unit.text).join(" ");
      const topicWords = keywords(text, 3);
      const hook = hookFromUnits(span);
      const title = titleFrom(span, hook);
      results.push({
        id: createHash("sha256").update(`${sourceId}:${start}:${end}`).digest("hex").slice(0, 16), sourceId, start, end, duration: Number((end - start).toFixed(3)),
        transcript: text.slice(0, 4000), words: span.reduce((sum, unit) => sum + (unit.words.length || unit.text.split(/\s+/).length), 0),
        hook, title, topic: topicWords.slice(0, 2).join(" · ") || "conversation", hashtags: topicWords.map((word) => `#${word.replace(/[^a-z0-9]/g, "")}`).filter((tag) => tag.length > 2),
        postCaption: "", role: "highlight", editorialScore: editorialScore(feature), reasons: reasonsFor(feature), rankedBy: "heuristic", features: feature,
      });
      results[results.length - 1].postCaption = postCaptionFor(results[results.length - 1], sourceLabel);
    }
  }
  return results;
}

function postCaptionFor(highlight: Pick<Highlight, "title" | "transcript" | "hashtags">, sourceLabel: string) {
  const excerpt = highlight.transcript.length > 160 ? `${highlight.transcript.slice(0, 157).replace(/\s+\S*$/, "")}…` : highlight.transcript;
  return `${highlight.title}\n\n“${excerpt}”\n\nExcerpt from ${sourceLabel || "the full recording"}. ${highlight.hashtags.join(" ")}`.trim().slice(0, 600);
}

/** Non-maximum suppression: keep the best window per region so the shortlist is not twelve copies of one moment. */
export function shortlist(candidates: Highlight[], size = 12): Highlight[] {
  const kept: Highlight[] = [];
  for (const candidate of [...candidates].sort((a, b) => b.editorialScore - a.editorialScore || a.start - b.start)) {
    const overlaps = kept.some((item) => Math.min(item.end, candidate.end) - Math.max(item.start, candidate.start) > 0.4 * Math.min(item.duration, candidate.duration));
    if (!overlaps) kept.push(candidate);
    if (kept.length === size) break;
  }
  return kept;
}

/** Maximal marginal relevance: strong but different moments that never overlap. */
export function selectDistinct(pool: Highlight[], count = 3, diversity = 0.35): Highlight[] {
  const chosen: Highlight[] = [];
  const bags = new Map(pool.map((item) => [item.id, bag([item.transcript])]));
  while (chosen.length < count) {
    let best: { item: Highlight; value: number } | undefined;
    for (const item of pool) {
      if (chosen.includes(item) || chosen.some((other) => item.start < other.end + 0.5 && other.start < item.end + 0.5)) continue;
      const similarity = chosen.reduce((max, other) => Math.max(max, cosine(bags.get(item.id)!, bags.get(other.id)!)), 0);
      const value = item.editorialScore / 100 - diversity * similarity;
      if (!best || value > best.value) best = { item, value };
    }
    if (!best) break;
    chosen.push(best.item);
  }
  return assignRoles(chosen).sort((a, b) => a.start - b.start);
}

function assignRoles(items: Highlight[]): Highlight[] {
  const remaining = new Set(items.map((item) => item.id));
  const pick = (role: Role, key: keyof Features) => {
    const best = items.filter((item) => remaining.has(item.id)).sort((a, b) => b.features[key] - a.features[key] || b.editorialScore - a.editorialScore)[0];
    if (best && best.features[key] > 0.2) { best.role = role; remaining.delete(best.id); }
  };
  pick("attention", "hook"); pick("takeaway", "takeaway"); pick("story", "story");
  return items;
}

const NUMBER = /\d+(?:[.,]\d+)?/g;
/** A model hook is accepted only if it is short, adds no numbers absent from the speech, and shares real words with it. */
export function faithfulHook(hook: string, transcript: string): boolean {
  const clean = cleanOverlayText(hook, 60);
  if (clean.length < 3 || clean.length > 52) return false;
  const spoken = new Set(transcript.match(NUMBER) || []);
  if ((clean.match(NUMBER) || []).some((value) => !spoken.has(value))) return false;
  const words = new Set(tokens(transcript));
  return tokens(clean).some((word) => words.has(word) || words.has(word.replace(/s$/, "")));
}

const rankingSchema = z.object({ rankings: z.array(z.object({ candidateId: z.string().length(16), editorialScore: z.number().int().min(0).max(100), hook: z.string().min(2).max(60), suggestedTitle: z.string().min(2).max(60), reasons: z.array(z.string().max(60)).max(3) })).min(1).max(6) });
const rankingJsonSchema = {
  type: "object", additionalProperties: false, required: ["rankings"],
  properties: { rankings: { type: "array", minItems: 1, maxItems: 6, items: { type: "object", additionalProperties: false, required: ["candidateId", "editorialScore", "hook", "suggestedTitle", "reasons"], properties: { candidateId: { type: "string" }, editorialScore: { type: "integer", minimum: 0, maximum: 100 }, hook: { type: "string", maxLength: 52 }, suggestedTitle: { type: "string", maxLength: 52 }, reasons: { type: "array", maxItems: 3, items: { type: "string", maxLength: 40 } } } } } },
};

/** Batches of six shortlisted windows; long recordings never send the whole transcript in one prompt. */
async function rankWithModel(pool: Highlight[], preferences: Preferences, provider: LocalModelProvider): Promise<{ ranked: Highlight[]; model: string; latencyMs: number }> {
  const ranked = new Map(pool.map((item) => [item.id, { ...item }]));
  let latency = 0, model = "";
  for (let index = 0; index < pool.length; index += 6) {
    const batch = pool.slice(index, index + 6);
    const result = await provider.structured({
      name: "highlight_ranking", schema: rankingSchema, jsonSchema: rankingJsonSchema, maxTokens: 900, temperature: 0.2, timeoutMs: 60_000,
      messages: [
        { role: "system", content: "You are an editor choosing short vertical clips from a long recording for a general, school-safe audience. Score each candidate 0-100 for: strong opening, self-contained meaning, clear takeaway, emotional interest, curiosity, quotability, story structure, fit for short video, little missing context. Hooks and titles must be faithful to what is said: no new facts, numbers, names or exaggeration. Use only the given candidate ids. Reply with JSON only." },
        { role: "user", content: JSON.stringify({ focus: preferences.tone, candidates: batch.map((item) => ({ candidateId: item.id, seconds: Math.round(item.duration), text: item.transcript.slice(0, 700) })) }) },
      ],
    });
    latency += result.latencyMs; model = result.model;
    for (const item of result.value.rankings) {
      const candidate = ranked.get(item.candidateId);
      if (!candidate || !batch.some((entry) => entry.id === item.candidateId)) continue; // hallucinated or out-of-batch ids are ignored
      candidate.editorialScore = Math.round(0.6 * item.editorialScore + 0.4 * candidate.editorialScore);
      if (faithfulHook(item.hook, candidate.transcript)) candidate.hook = cleanOverlayText(item.hook, 52);
      if (faithfulHook(item.suggestedTitle, candidate.transcript)) candidate.title = cleanOverlayText(item.suggestedTitle, 52);
      candidate.reasons = item.reasons.map((reason) => cleanOverlayText(reason, 60)).filter(Boolean).slice(0, 3);
      candidate.rankedBy = "qwen";
    }
  }
  if (![...ranked.values()].some((item) => item.rankedBy === "qwen")) throw new ProviderError("invalid-output", "Model ranking referenced no known candidates.");
  return { ranked: [...ranked.values()], model, latencyMs: latency };
}

export async function discoverHighlights(input: { sourceId: string; sourceLabel: string; transcript: Transcript; preferences: Preferences; profile?: { step: number; rms: number[] }; useModel?: boolean; provider?: LocalModelProvider }): Promise<Discovery> {
  const started = Date.now();
  const all = generateHighlights(input.sourceId, input.sourceLabel, input.transcript, input.preferences, input.profile);
  let pool = shortlist(all.filter((item) => item.features.boilerplate < 0.5), 12);
  let rankedBy: Discovery["rankedBy"] = "heuristic", model: string | undefined, modelLatencyMs = 0, fallbackReason: string | undefined;
  if (input.useModel !== false && pool.length) {
    try { const result = await rankWithModel(pool, input.preferences, input.provider || creativeModel()); pool = result.ranked; rankedBy = "qwen"; model = result.model; modelLatencyMs = result.latencyMs; }
    catch (error) { fallbackReason = error instanceof ProviderError ? error.message : "Model ranking failed; the editorial heuristic was used."; }
  }
  pool.forEach((item) => { item.postCaption = postCaptionFor(item, input.sourceLabel); });
  const selected = selectDistinct(pool, 3);
  const [minSeconds] = LENGTH_PRESETS[input.preferences.length];
  const notice = !input.transcript.segments.length ? "No speech was found in this recording, so there are no highlights to make."
    : selected.length < 3 ? `This recording supports ${selected.length || "no"} distinct ${minSeconds}+ second moment${selected.length === 1 ? "" : "s"} at the chosen length. Try a shorter clip length rather than accepting weaker picks.` : undefined;
  return { preferences: input.preferences, windows: all.length, pool: pool.sort((a, b) => b.editorialScore - a.editorialScore), selected, notice, rankedBy, model, modelLatencyMs, fallbackReason, analysisMs: Date.now() - started };
}

/** Moves a visitor-adjusted interval onto silence between words, inside the media and within sane bounds. */
export function snapInterval(transcript: Transcript, start: number, end: number): { start: number; end: number } {
  const words = transcript.wordTimestamps ? transcript.segments.flatMap((segment) => segment.words || []) : transcript.segments.map((segment) => ({ text: segment.text, start: segment.start, end: segment.end }));
  let snappedStart = Math.max(0, start), snappedEnd = Math.min(transcript.duration, end);
  for (const word of words) {
    if (snappedStart > word.start && snappedStart < word.end) snappedStart = word.start;
    if (snappedEnd > word.start && snappedEnd < word.end) snappedEnd = word.end;
  }
  if (snappedEnd - snappedStart < 5) throw new Error("A highlight needs at least five seconds.");
  if (snappedEnd - snappedStart > 90) throw new Error("A highlight can be at most 90 seconds.");
  return { start: Number(snappedStart.toFixed(3)), end: Number(snappedEnd.toFixed(3)) };
}
