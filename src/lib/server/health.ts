import { ffmpeg, ffprobe, runProcess } from "@/lib/video/process";

/** Coalesce simultaneous health probes and briefly cache both success and failure. */
export function cachedCheck(check: () => Promise<void>, ttlMs: number) {
  let pending: Promise<boolean> | undefined;
  let result = false, expiresAt = 0;
  return async (): Promise<boolean> => {
    if (pending) return pending;
    if (Date.now() < expiresAt) return result;
    pending = check().then(() => true, () => false).then((value) => {
      result = value; expiresAt = Date.now() + ttlMs; pending = undefined;
      return value;
    });
    return pending;
  };
}

const state = globalThis as typeof globalThis & { studioMediaHealth?: () => Promise<boolean> };
export const mediaHealthy = state.studioMediaHealth ||= cachedCheck(async () => {
  await Promise.all([runProcess(ffmpeg(), ["-version"], "FFmpeg health check", 10_000), runProcess(ffprobe(), ["-version"], "FFprobe health check", 10_000)]);
}, 30_000);
