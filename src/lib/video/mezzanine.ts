import { ffmpeg, runProcess } from "./process";
import { MEDIA_INPUT_OPTIONS } from "./input-policy";

/**
 * The single upload normalization used by the API, tests and benchmarks: autorotated, constant 30fps, aspect
 * ratio preserved (no baked-in letterbox) and capped at 1080p so the renderer can reframe and export 1080x1920
 * without upscaling. Audio, when present, becomes 48 kHz stereo AAC.
 */
export async function createMezzanine(input: string, output: string, maxSeconds: number): Promise<void> {
  await runProcess(ffmpeg(), ["-y", "-v", "error", "-xerror", "-threads", "2", ...MEDIA_INPUT_OPTIONS, "-i", input, "-t", String(maxSeconds), "-map", "0:v:0", "-map", "0:a:0?",
    "-vf", "scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30,setsar=1", "-filter_threads", "1",
    "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "48000", "-movflags", "+faststart", output], "Upload normalization", 180_000);
}
