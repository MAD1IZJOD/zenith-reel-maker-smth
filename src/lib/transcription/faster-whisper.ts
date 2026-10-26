import { access, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ffmpeg, runProcess } from "@/lib/video/process";
import { transcriptSchema, type Transcript } from "./schema";

/**
 * Local speech recognition through a fixed Python worker (workers/transcribe.py) in a dedicated environment.
 * Only the allow-listed models below can be requested; arguments are passed as an array, never through a shell.
 */
export const WHISPER_MODELS = ["tiny", "tiny.en", "base", "base.en", "small", "small.en"] as const;
export type WhisperModel = typeof WHISPER_MODELS[number];

export function whisperConfig(env: Record<string, string | undefined> = process.env) {
  const model = (WHISPER_MODELS as readonly string[]).includes(env.TRANSCRIBE_MODEL || "") ? env.TRANSCRIBE_MODEL as WhisperModel : "base";
  const threads = Number(env.TRANSCRIBE_THREADS);
  const python = env.TRANSCRIBE_PYTHON || path.join(process.cwd(), ".venv-transcribe", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  return { model, python, worker: path.join(process.cwd(), "workers", "transcribe.py"), threads: Number.isInteger(threads) && threads > 0 && threads <= 8 ? threads : 4 };
}

let availability: Promise<{ available: boolean; reason?: string }> | undefined;
/** Checks once per process that the environment can import faster-whisper. */
export function transcriptionAvailability(): Promise<{ available: boolean; reason?: string }> {
  availability ||= (async () => {
    const { python, worker } = whisperConfig();
    try { await access(python); } catch { return { available: false, reason: "The transcription environment is not installed. See README: Local transcription." }; }
    try { await runProcess(python, [worker, "--input", "-", "--output", "-", "--check"], "Transcription check", 60_000); return { available: true }; }
    catch { return { available: false, reason: "faster-whisper could not be loaded in the transcription environment." }; }
  })();
  return availability;
}

/** 16 kHz mono PCM is what Whisper consumes; extracting once also strips video for a faster, smaller worker input. */
export async function extractSpeechAudio(source: string, output: string, seconds: number): Promise<void> {
  await runProcess(ffmpeg(), ["-y", "-v", "error", "-i", source, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", output], "Speech audio extraction", 60_000 + seconds * 1000);
}

export async function transcribeWithWhisper(audio: string, output: string, seconds: number, language?: string): Promise<Transcript> {
  const { python, worker, model, threads } = whisperConfig();
  const args = [worker, "--input", audio, "--output", output, "--model", model, "--threads", String(threads)];
  if (language && /^[a-z]{2,3}$/.test(language)) args.push("--language", language);
  // CPU int8 speed varies widely; allow the first model download plus up to 3x real time.
  await runProcess(python, args, "Speech transcription", 300_000 + seconds * 3000);
  const parsed = transcriptSchema.safeParse(JSON.parse(await readFile(output, "utf8")));
  if (!parsed.success) { await rm(output, { force: true }); throw new Error("The transcription result failed validation."); }
  return parsed.data;
}

/** Several short files in one worker run, so the model loads once (clip shots are transcribed together). */
export async function transcribeBatch(pairs: { audio: string; output: string }[], batchFile: string, seconds: number): Promise<(Transcript | undefined)[]> {
  const { python, worker, model, threads } = whisperConfig();
  await writeFile(batchFile, JSON.stringify(pairs.map((pair) => ({ input: pair.audio, output: pair.output }))), "utf8");
  try { await runProcess(python, [worker, "--batch", batchFile, "--model", model, "--threads", String(threads)], "Speech transcription", 300_000 + seconds * 3000); }
  finally { await rm(batchFile, { force: true }); }
  return Promise.all(pairs.map(async (pair) => { try { const parsed = transcriptSchema.safeParse(JSON.parse(await readFile(pair.output, "utf8"))); return parsed.success ? parsed.data : undefined; } catch { return undefined; } }));
}
