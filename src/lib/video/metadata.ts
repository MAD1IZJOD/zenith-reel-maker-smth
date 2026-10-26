import { ffprobe, runProcess } from "./process";

export type VideoMetadata = { duration: number; formatName: string; width: number; height: number; codecName: string; hasAudio: boolean };

export async function probeVideo(file: string): Promise<VideoMetadata> {
  const output = await runProcess(ffprobe(), ["-v", "error", "-show_entries", "format=format_name,duration:stream=codec_type,codec_name,width,height", "-of", "json", file], "FFprobe");
  const json = JSON.parse(output) as { format?: { duration?: string; format_name?: string }; streams?: { codec_type: string; codec_name?: string; width?: number; height?: number }[] };
  const stream = json.streams?.find((entry) => entry.codec_type === "video");
  const duration = Number(json.format?.duration);
  if (!stream || !Number.isFinite(duration) || duration <= 0 || duration > 90 || !stream.width || !stream.height) throw new Error("Video must contain a visual track between 1 second and 90 seconds.");
  return {
    duration,
    formatName: json.format?.format_name || "unknown",
    width: stream.width,
    height: stream.height,
    codecName: stream.codec_name || "unknown",
    hasAudio: json.streams?.some((entry) => entry.codec_type === "audio") || false,
  };
}
