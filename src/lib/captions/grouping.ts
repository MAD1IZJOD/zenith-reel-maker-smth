import type { CaptionStyleId } from "@/lib/edit/styles";

export type TimedWord = { text: string; start: number; end: number };
export type WordGroup = { start: number; end: number; words: TimedWord[] };

const LIMITS: Record<CaptionStyleId, { words: number; chars: number }> = {
  "clean-creator": { words: 3, chars: 22 },
  "high-energy": { words: 2, chars: 16 },
  "podcast-pop": { words: 4, chars: 30 },
  cinematic: { words: 5, chars: 34 },
  minimal: { words: 6, chars: 44 },
};

/** Display form: keep question/exclamation marks, drop trailing commas and full stops typical of social captions. */
export const displayWord = (text: string) => text.trim().replace(/^["'“”‘’(]+|["'“”‘’)]+$/g, "").replace(/[.,;:]+$/g, "");

/**
 * Groups real word timestamps into short, readable caption groups. Breaks on pauses, sentence punctuation and
 * per-style limits. Never invents or redistributes times: a group spans its first word start to its last word end,
 * extended only into silence (up to 0.35s) so short words remain readable.
 */
export function groupWords(words: TimedWord[], style: CaptionStyleId): WordGroup[] {
  const limit = LIMITS[style];
  const clean = words.filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end) && word.end >= word.start && displayWord(word.text)).sort((a, b) => a.start - b.start);
  const groups: WordGroup[] = [];
  let current: TimedWord[] = [];
  const flush = () => { if (current.length) groups.push({ start: current[0].start, end: current[current.length - 1].end, words: current.map((word) => ({ ...word, text: displayWord(word.text) })) }); current = []; };
  for (const [index, word] of clean.entries()) {
    const previous = clean[index - 1];
    const chars = [...current, word].map((item) => displayWord(item.text)).join(" ").length;
    if (current.length && (current.length >= limit.words || chars > limit.chars || word.start - previous.end > 0.45 || /[.,!?;:]["'”’)]*$/.test(previous.text.trim()))) flush();
    current.push(word);
  }
  flush();
  for (const [index, group] of groups.entries()) {
    const next = groups[index + 1];
    const desired = Math.max(group.end + 0.25, group.start + 0.6);
    group.end = Number((next ? Math.min(desired, next.start) : desired).toFixed(3));
  }
  return groups;
}
