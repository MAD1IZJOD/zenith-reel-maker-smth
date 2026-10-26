import { access, rm } from "node:fs/promises";
import path from "node:path";
import { readJson } from "@/lib/server/store";
import type { TimedWord } from "@/lib/captions/grouping";
import { extractSpeechAudio, transcribeBatch, transcriptionAvailability, whisperConfig } from "./faster-whisper";
import { transcriptSchema, transcriptWords, type Transcript } from "./schema";

let chain: Promise<unknown> = Promise.resolve();

/**
 * Word timings for each recorded shot, transcribed once per immutable source snapshot (one worker run, one
 * model load) and reused by every later export of the same footage. Silent shots, or an unavailable engine,
 * yield undefined so the edit uses title cards; guessed timings are never substituted.
 */
export async function shotTranscripts(snapshot: string, hasAudio: boolean[]): Promise<{ words: (TimedWord[] | undefined)[]; available: boolean }> {
  if (!(await transcriptionAvailability()).available) return { words: [undefined, undefined, undefined], available: false };
  const model = whisperConfig().model;
  const cachePath = (shot: number) => path.join(snapshot, `shot-${shot}-transcript-${model}.json`);
  const cached = await Promise.all([1, 2, 3].map(async (shot) => { const value = await readJson<Transcript>(cachePath(shot)).catch(() => undefined); return value && transcriptSchema.safeParse(value).success ? value : undefined; }));
  const missing = [1, 2, 3].filter((shot, index) => hasAudio[index] && !cached[index]);
  if (missing.length) {
    const run = chain.catch(() => undefined).then(async () => {
      const pairs = missing.map((shot) => ({ shot, audio: path.join(snapshot, `shot-${shot}-speech.wav`), output: cachePath(shot) }));
      try {
        for (const pair of pairs) { await access(path.join(snapshot, `shot-${pair.shot}.mp4`)); await extractSpeechAudio(path.join(snapshot, `shot-${pair.shot}.mp4`), pair.audio, 90); }
        const results = await transcribeBatch(pairs, path.join(snapshot, "transcribe-batch.json"), 90 * pairs.length);
        pairs.forEach((pair, index) => { cached[pair.shot - 1] = results[index]; });
      } catch { /* Title cards are used for any shot without a transcript. */ }
      finally { await Promise.all(pairs.map((pair) => rm(pair.audio, { force: true }))); }
    });
    chain = run;
    await run;
  }
  return { words: cached.map((transcript, index) => (hasAudio[index] && transcript ? transcriptWords(transcript) : undefined)), available: true };
}
