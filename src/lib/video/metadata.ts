import { ffprobe, runProcess } from "./process";
import { limit } from "@/lib/server/config";

export type VideoMetadata = { duration: number; formatName: string; width: number; height: number; codecName: string; hasAudio: boolean };

export async function probeVideo(file: string, allowUnknownDuration = false): Promise<VideoMetadata> {
  const output = await runProcess(ffprobe(), ["-v", "error", "-show_entries", "format=format_name,duration:stream=codec_type,codec_name,width,height", "-of", "json", file], "FFprobe");
  const json = JSON.parse(output) as { format?: { duration?: string; format_name?: string }; streams?: { codec_type: string; codec_name?: string; width?: number; height?: number }[] };
  const stream = json.streams?.find((entry) => entry.codec_type === "video");
  const duration = Number(json.format?.duration);
  const maxDuration = limit("MAX_CLIP_DURATION", 90, 180);
  if (!stream || (!allowUnknownDuration && (!Number.isFinite(duration) || duration < 0.5)) || Number.isFinite(duration) && duration > maxDuration || !stream.width || !stream.height || stream.width * stream.height > 33_200_000) throw new Error(`Video must have a decodable visual track from 0.5 to ${maxDuration} seconds, up to 8K resolution.`);
  return {
    duration: Number.isFinite(duration) ? duration : 0,
    formatName: json.format?.format_name || "unknown",
    width: stream.width,
    height: stream.height,
    codecName: stream.codec_name || "unknown",
    hasAudio: json.streams?.some((entry) => entry.codec_type === "audio") || false,
  };
}
