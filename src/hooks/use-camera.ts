"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { cameraErrorMessage, recorderMimeType } from "@/lib/camera/capabilities";

/** Owns tracks and recorder lifetimes, including late permission responses. Audio is intentionally off. */
export function useCamera(onClip: (file: File, shot: number) => void, shot: number) {
  const [stream, setStream] = useState<MediaStream>();
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [countdown, setCountdown] = useState<number>();
  const [cameraError, setCameraError] = useState<string>();
  const [opening, setOpening] = useState(false);
  const facing = useRef<"user" | "environment">("user");
  const tracks = useRef<MediaStream | undefined>(undefined);
  const recorder = useRef<MediaRecorder | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const generation = useRef(0);
  const callback = useRef(onClip);
  const mounted = useRef(true);
  callback.current = onClip;
  const stopCamera = useCallback((saveRecording = false) => {
    generation.current += 1;
    if (timer.current) clearInterval(timer.current);
    timer.current = undefined;
    const current = recorder.current;
    if (current && current.state !== "inactive") {
      if (!saveRecording) current.onstop = null;
      current.stop();
    }
    tracks.current?.getTracks().forEach((track) => track.stop());
    tracks.current = undefined;
    if (mounted.current) { setStream(undefined); setRecording(false); setCountdown(undefined); setOpening(false); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const hide = () => { if (document.hidden) { setCameraError("Camera closed while the page was in the background. Review any saved clip, or reopen it."); stopCamera(true); } };
    document.addEventListener("visibilitychange", hide);
    return () => { mounted.current = false; document.removeEventListener("visibilitychange", hide); stopCamera(); };
  }, [stopCamera]);
  async function openCamera(nextFacing = facing.current) {
    stopCamera(); setCameraError(undefined);
    if (!window.isSecureContext) { setCameraError("Camera access needs HTTPS or localhost. Use Upload video or your phone camera below."); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setCameraError("In-page recording is unavailable. Use your phone camera or Upload video below."); return; }
    const request = generation.current;
    setOpening(true);
    try {
      const next = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: nextFacing }, width: { ideal: 720 }, height: { ideal: 1280 } }, audio: false });
      if (request !== generation.current || !mounted.current) { next.getTracks().forEach((track) => track.stop()); return; }
      tracks.current = next; facing.current = nextFacing; setStream(next);
      next.getVideoTracks().forEach((track) => track.addEventListener("ended", () => { if (tracks.current === next) { setCameraError("Camera disconnected. Reopen it or upload a clip."); stopCamera(true); } }, { once: true }));
    } catch (error) { if (request === generation.current && mounted.current) setCameraError(cameraErrorMessage(error)); }
    finally { if (request === generation.current && mounted.current) setOpening(false); }
  }
  function beginRecording() {
    if (!tracks.current || timer.current) return;
    const targetShot = shot;
    let remaining = 3; setCountdown(remaining);
    timer.current = setInterval(() => {
      remaining -= 1; setCountdown(remaining || undefined);
      if (remaining) return;
      clearInterval(timer.current); timer.current = undefined;
      try {
        const mimeType = recorderMimeType();
        const current = new MediaRecorder(tracks.current!, mimeType ? { mimeType } : undefined);
        recorder.current = current;
        const chunks: Blob[] = [];
        current.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
        current.onerror = () => { setCameraError("Recording interrupted. Reopen the camera or upload a clip."); stopCamera(); };
        current.onstop = () => {
          const type = (current.mimeType || chunks[0]?.type || "video/webm").split(";")[0];
          const blob = new Blob(chunks, { type });
          if (mounted.current && blob.size) callback.current(new File([blob], `recorded-shot-${targetShot + 1}.${type.includes("mp4") ? "mp4" : "webm"}`, { type }), targetShot);
          else if (mounted.current) setCameraError("The recording was empty. Try a longer clip or upload a video.");
        };
        current.start(500); setRecording(true); setRecordSeconds(0);
        let elapsed = 0;
        timer.current = setInterval(() => { elapsed += 1; setRecordSeconds(elapsed); if (elapsed >= 30) stopCamera(true); }, 1000);
      } catch { setCameraError("This browser cannot record this camera format. Use your phone camera or Upload video."); stopCamera(); }
    }, 1000);
  }
  return { stream, recording, recordSeconds, countdown, cameraError, setCameraError, opening, openCamera, stopCamera, beginRecording, stopRecording: () => stopCamera(true), switchCamera: () => openCamera(facing.current === "user" ? "environment" : "user") };
}
