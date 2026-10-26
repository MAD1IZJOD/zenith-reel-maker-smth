import type { ShotAnalysis } from "@/lib/video/shot-analysis-types";
type UploadResult = { previewUrl: string; metadata: { duration: number }; analysis: ShotAnalysis };
class BusyError extends Error {}

/** Waits this long in total for a busy studio (HTTP 429) before showing an error. */
const BUSY_WAIT_MS = 60_000;

function send(form: FormData, progress: (value: number) => void): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); xhr.open("POST", "/api/uploads"); xhr.timeout = 210_000;
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
    xhr.onerror = () => reject(new Error("Connection lost. Your selected clip is kept here; reconnect and retry."));
    xhr.ontimeout = () => reject(new Error("Upload timed out. Your selected clip is kept here. Retry or choose a shorter video."));
    xhr.onload = () => { try { const data = JSON.parse(xhr.responseText); if (xhr.status >= 200 && xhr.status < 300) resolve(data); else if (xhr.status === 429) reject(new BusyError(data.error || "The studio is busy.")); else reject(new Error(data.error || "Upload failed. Please retry.")); } catch { reject(new Error("The server could not accept this clip. Please retry.")); } };
    xhr.send(form);
  });
}

/**
 * Uploads one clip. When the studio is busy with other visitors' clips it answers 429; the upload then waits briefly and
 * tries again by itself (progress reports -1 while waiting) instead of making the visitor retry by hand.
 */
export async function uploadClip(form: FormData, progress: (value: number) => void): Promise<UploadResult> {
  const deadline = Date.now() + BUSY_WAIT_MS;
  for (let attempt = 1; ; attempt++) {
    try { return await send(form, progress); }
    catch (error) {
      if (!(error instanceof BusyError) || Date.now() > deadline) throw error;
      progress(-1);
      await new Promise((resolve) => setTimeout(resolve, Math.min(4000, 800 * attempt) + Math.random() * 700));
    }
  }
}
