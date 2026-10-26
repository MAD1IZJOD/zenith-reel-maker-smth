import { z } from "zod";

/** Real recognized or imported speech only. Word times exist only when the engine measured them. */
const time = z.number().finite().min(0).max(86_400);
export const transcriptWordSchema = z.object({ text: z.string().min(1).max(80), start: time, end: time, probability: z.number().min(0).max(1).optional() }).refine((word) => word.end >= word.start, "Word ends before it starts.");
export const transcriptSegmentSchema = z.object({ start: time, end: time, text: z.string().max(2000), words: z.array(transcriptWordSchema).max(2000).optional() }).refine((segment) => segment.end >= segment.start, "Segment ends before it starts.");
export const transcriptSchema = z.object({
  version: z.literal(1),
  engine: z.enum(["faster-whisper", "import"]),
  model: z.string().max(60).optional(),
  language: z.string().max(12).optional(),
  duration: z.number().finite().min(0).max(86_400),
  wordTimestamps: z.boolean(),
  segments: z.array(transcriptSegmentSchema).max(20_000),
}).superRefine((transcript, context) => {
  let previous = 0;
  for (const segment of transcript.segments) {
    if (segment.start < previous - 0.5) context.addIssue({ code: z.ZodIssueCode.custom, message: "Segments must be in time order." });
    if (segment.end > transcript.duration + 1) context.addIssue({ code: z.ZodIssueCode.custom, message: "Segment extends past the media duration." });
    previous = segment.start;
  }
});
export type Transcript = z.infer<typeof transcriptSchema>;
export type TranscriptWord = z.infer<typeof transcriptWordSchema>;

/** All words in order, only when the transcript carries measured word timestamps. */
export const transcriptWords = (transcript: Transcript): TranscriptWord[] => (transcript.wordTimestamps ? transcript.segments.flatMap((segment) => segment.words || []) : []);

const clock = (value: string) => { const match = value.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/); if (!match) throw new Error(`Invalid timestamp "${value}".`); return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4].padEnd(3, "0")) / 1000; };

/**
 * Imports a transcript the visitor already has: Zenith/whisper-style JSON (validated), or SRT/WebVTT cues.
 * Cue files carry segment times only, so they are stored without word timestamps; nothing is interpolated.
 */
export function importTranscript(text: string, duration: number): Transcript {
  const trimmed = text.replace(/^﻿/, "").trim();
  if (!trimmed) throw new Error("The transcript is empty.");
  if (trimmed.length > 4_000_000) throw new Error("The transcript is too large.");
  if (trimmed.startsWith("{")) {
    const parsed = transcriptSchema.safeParse({ version: 1, engine: "import", duration, ...JSON.parse(trimmed) });
    if (!parsed.success) throw new Error(`Transcript JSON is invalid: ${parsed.error.issues[0]?.message}`);
    return { ...parsed.data, engine: "import", duration };
  }
  const segments: Transcript["segments"] = [];
  for (const block of trimmed.replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = block.split("\n").filter((line) => line.trim() && !/^WEBVTT/.test(line) && !/^NOTE\b/.test(line));
    const cue = lines.findIndex((line) => line.includes("-->"));
    if (cue < 0) continue;
    const [from, to] = lines[cue].split("-->").map((part) => part.trim().split(/\s+/)[0]);
    const words = lines.slice(cue + 1).join(" ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (words) segments.push({ start: clock(from), end: clock(to), text: words.slice(0, 2000) });
  }
  if (!segments.length) throw new Error("No timed cues were found. Import SRT or WebVTT captions, or transcript JSON with timestamps.");
  const parsed = transcriptSchema.safeParse({ version: 1, engine: "import", duration, wordTimestamps: false, segments });
  if (!parsed.success) throw new Error(`Transcript is invalid: ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}
