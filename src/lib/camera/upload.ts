import type { ShotAnalysis } from "@/lib/video/shot-analysis-types";
export function uploadClip(form: FormData, progress: (value: number) => void): Promise<{ previewUrl: string; metadata: { duration: number }; analysis: ShotAnalysis }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); xhr.open("POST", "/api/uploads"); xhr.timeout = 210_000;
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
    xhr.onerror = () => reject(new Error("Connection lost. Your selected clip is kept here; reconnect and retry."));
    xhr.ontimeout = () => reject(new Error("Upload timed out. Your selected clip is kept here. Retry or choose a shorter video."));
    xhr.onload = () => { try { const data = JSON.parse(xhr.responseText); if (xhr.status >= 200 && xhr.status < 300) resolve(data); else reject(new Error(data.error || "Upload failed. Please retry.")); } catch { reject(new Error("The server could not accept this clip. Please retry.")); } };
    xhr.send(form);
  });
}
