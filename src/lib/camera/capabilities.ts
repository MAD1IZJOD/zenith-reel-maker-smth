export function recorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  // VP8 works without a hardware H.264 encoder; Safari can fall back to its native MP4 implementation.
  return ["video/webm;codecs=vp8", "video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type));
}

export function cameraErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  const messages: Record<string, string> = {
    NotAllowedError: "Camera permission was denied. Allow it in browser settings, or use Upload video.",
    NotFoundError: "No camera was found. Use Upload video or the phone camera option.",
    NotReadableError: "The camera is busy. Close other camera apps and try again, or upload a clip.",
    OverconstrainedError: "This camera cannot use the requested settings. Try the other camera or upload a clip.",
    SecurityError: "Camera access needs HTTPS or localhost. Upload video is still available.",
  };
  return messages[name] || "Could not open this camera. Try again, switch cameras, or upload a clip.";
}
