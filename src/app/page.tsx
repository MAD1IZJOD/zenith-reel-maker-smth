"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Check, ChevronLeft, Download, Film, LoaderCircle, Play, RefreshCw, Shuffle, Sparkles, Upload, Video, X } from "lucide-react";
import { PRESETS, type ReelPreset } from "@/lib/presets";
import { createStudioAssist } from "@/lib/ai/studio";

type Screen = "welcome" | "presets" | "record" | "review" | "processing" | "preview";
type Shot = { previewUrl: string; duration: number; name: string };
type Job = { id: string; stage: "queued" | "validating" | "preparing" | "rendering" | "finalizing" | "completed" | "failed"; error?: string; outputUrl?: string; coverUrl?: string };
const challenges = ["Dramatic Entrance", "Unexpected Plot Twist", "Perfect Squad Sync", "Silent Storytelling", "Epic Transformation"];
const screens: Screen[] = ["welcome", "presets", "record", "review", "processing", "preview"];
const stages: Job["stage"][] = ["queued", "validating", "preparing", "rendering", "finalizing", "completed", "failed"];
const sessionPattern = /^[a-f0-9-]{36}$/i;

function isStoredShot(value: unknown): value is Shot {
  return typeof value === "object" && value !== null && "previewUrl" in value && "duration" in value && "name" in value
    && typeof value.previewUrl === "string" && typeof value.duration === "number" && typeof value.name === "string";
}

function isStoredJob(value: unknown): value is Job {
  return typeof value === "object" && value !== null && "id" in value && "stage" in value && typeof value.id === "string" && stages.includes(value.stage as Job["stage"]);
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [preset, setPreset] = useState<ReelPreset>(PRESETS[0]);
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const [shots, setShots] = useState<(Shot | undefined)[]>([undefined, undefined, undefined]);
  const [activeShot, setActiveShot] = useState(0);
  const [challenge, setChallenge] = useState<string>();
  const [title, setTitle] = useState(PRESETS[0].title);
  const [stream, setStream] = useState<MediaStream>();
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [countdown, setCountdown] = useState<number>();
  const [cameraFacing, setCameraFacing] = useState<"user" | "environment">("user");
  const [cameraError, setCameraError] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [job, setJob] = useState<Job>();
  const [publicDisplay, setPublicDisplay] = useState(false);
  const [promoReuse, setPromoReuse] = useState(false);
  const [restored, setRestored] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const recorder = useRef<MediaRecorder | undefined>(undefined);
  const chunks = useRef<Blob[]>([]);
  const countdownTimer = useRef<number | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function restoreDraft() {
      const savedSessionId = new URLSearchParams(window.location.search).get("session");
      if (!savedSessionId || !sessionPattern.test(savedSessionId)) { setRestored(true); return; }
      setSessionId(savedSessionId);
      try {
        const response = await fetch(`/api/sessions/${savedSessionId}`);
        if (!response.ok || cancelled) return;
        const { draft } = await response.json() as { draft: Record<string, unknown> };
        const storedPreset = PRESETS.find((item) => item.id === draft.presetId);
        if (storedPreset) setPreset(storedPreset);
        if (typeof draft.title === "string") setTitle(draft.title.slice(0, 52));
        if (typeof draft.activeShot === "number" && draft.activeShot >= 0 && draft.activeShot <= 2) setActiveShot(draft.activeShot);
        if (typeof draft.challenge === "string" && challenges.includes(draft.challenge)) setChallenge(draft.challenge);
        if (typeof draft.publicDisplay === "boolean") setPublicDisplay(draft.publicDisplay);
        if (typeof draft.promoReuse === "boolean") setPromoReuse(draft.promoReuse);
        if (typeof draft.screen === "string" && screens.includes(draft.screen as Screen)) setScreen(draft.screen as Screen);
        if (Array.isArray(draft.shots) && draft.shots.length === 3) setShots(draft.shots.map((shot) => isStoredShot(shot) ? shot : undefined));
        if (isStoredJob(draft.job)) setJob(draft.job);
      } catch { /* The visitor can continue with a fresh local session if recovery is unavailable. */ }
      finally { if (!cancelled) setRestored(true); }
    }
    void restoreDraft();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!restored) return;
    const current = new URL(window.location.href);
    if (current.searchParams.get("session") !== sessionId) {
      current.searchParams.set("session", sessionId);
      window.history.replaceState(null, "", current);
    }
    void fetch(`/api/sessions/${sessionId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ screen, presetId: preset.id, shots, activeShot, challenge, title, job, publicDisplay, promoReuse }) });
  }, [activeShot, challenge, job, preset.id, promoReuse, publicDisplay, restored, screen, sessionId, shots, title]);

  useEffect(() => {
    if (videoRef.current && stream) { videoRef.current.srcObject = stream; void videoRef.current.play(); }
  }, [stream, screen]);
  useEffect(() => () => stream?.getTracks().forEach((track) => track.stop()), [stream]);
  useEffect(() => {
    if (!recording) return;
    setRecordSeconds(0);
    const timer = window.setInterval(() => setRecordSeconds((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);
  useEffect(() => {
    if (!job || job.stage === "completed" || job.stage === "failed") return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/jobs?id=${job.id}`);
      if (response.ok) setJob((await response.json()).job);
    }, 1200);
    return () => window.clearInterval(timer);
  }, [job]);
  useEffect(() => { if (job?.stage === "completed") setScreen("preview"); }, [job]);

  function stopCamera() { if (countdownTimer.current) window.clearInterval(countdownTimer.current); countdownTimer.current = undefined; recorder.current?.state === "recording" && recorder.current.stop(); stream?.getTracks().forEach((track) => track.stop()); setStream(undefined); setRecording(false); setCountdown(undefined); }
  async function openCamera(nextFacing = cameraFacing) {
    setCameraError(undefined); stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) { setCameraError("This browser cannot access a camera. Upload a gallery video instead."); return; }
    try { setStream(await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: nextFacing }, width: { ideal: 720 }, height: { ideal: 1280 } }, audio: false })); }
    catch (error) { setCameraError(error instanceof DOMException && error.name === "NotAllowedError" ? "Camera access was denied. You can still upload a video from your gallery." : "We could not open this camera. On mobile, use HTTPS or localhost, or upload instead."); }
  }
  async function switchCamera() { const next = cameraFacing === "user" ? "environment" : "user"; setCameraFacing(next); await openCamera(next); }
  function beginRecording() {
    if (!stream) return;
    setCountdown(3);
    let value = 3;
    countdownTimer.current = window.setInterval(() => { value -= 1; setCountdown(value || undefined); if (!value) { if (countdownTimer.current) window.clearInterval(countdownTimer.current); countdownTimer.current = undefined; startRecorder(); } }, 1000);
  }
  function startRecorder() {
    try {
      chunks.current = [];
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8") ? "video/webm;codecs=vp8" : "video/webm";
      recorder.current = new MediaRecorder(stream!, { mimeType });
      recorder.current.ondataavailable = (event) => event.data.size && chunks.current.push(event.data);
      recorder.current.onstop = () => { const blob = new Blob(chunks.current, { type: mimeType }); void uploadFile(new File([blob], `recorded-shot-${activeShot + 1}.webm`, { type: mimeType })); };
      recorder.current.start(); setRecording(true); setRecordSeconds(0);
    } catch { setCameraError("Recording is not supported here. Upload a video instead."); }
  }
  function stopRecording() { recorder.current?.stop(); setRecording(false); }
  async function uploadFile(file: File, shotIndex = activeShot) {
    setUploading(true); setCameraError(undefined);
    try {
      const form = new FormData(); form.append("sessionId", sessionId); form.append("shot", String(shotIndex + 1)); form.append("file", file);
      const response = await fetch("/api/uploads", { method: "POST", body: form });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setShots((current) => { const next = [...current]; next[shotIndex] = { previewUrl: data.previewUrl, duration: Math.round(data.metadata.duration * 10) / 10, name: file.name }; return next; });
      stopCamera();
    } catch (error) { setCameraError(error instanceof Error ? error.message : "Upload failed."); }
    finally { setUploading(false); }
  }
  async function loadSamples() {
    setScreen("record"); setUploading(true); setCameraError(undefined);
    try {
      for (let i = 0; i < 3; i += 1) { setActiveShot(i); const response = await fetch(`/samples/shot-${i + 1}.mp4`); if (!response.ok) throw new Error("Sample clip could not be loaded."); const blob = await response.blob(); await uploadFile(new File([blob], `festival-sample-${i + 1}.mp4`, { type: "video/mp4" }), i); }
      setActiveShot(2); setScreen("review");
    } catch { setCameraError("Sample clips are unavailable. Please upload your own clips."); }
    finally { setUploading(false); }
  }
  async function generate() {
    setScreen("processing");
    const response = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, presetId: preset.id, title, consent: { publicDisplay, promoReuse } }) });
    const data = await response.json();
    if (!response.ok) { setJob({ id: "", stage: "failed", error: data.error }); return; }
    setJob(data.job);
  }
  function choosePreset(next: ReelPreset) { setPreset(next); setTitle(next.title); setScreen("record"); }
  const assist = createStudioAssist(preset, { challenge });
  const guide = assist.director[activeShot].direction;
  const isReady = shots.every(Boolean);

  return <main>
    <header><button className="brand" onClick={() => { stopCamera(); setScreen("welcome"); }}><span className="brand-mark">S</span> Squad Reel Studio</button>{screen !== "welcome" && <div className="stepper">{["Preset", "Shots", "Review", "Export"].map((step, i) => <span className={(screen === "presets" && i === 0) || (screen === "record" && i === 1) || (screen === "review" && i === 2) || (["processing", "preview"].includes(screen) && i === 3) ? "active" : ""} key={step}>{i + 1} {step}</span>)}</div>}</header>
    {screen === "welcome" && <section className="welcome"><p className="eyebrow">COLLEGE FESTIVAL EDITION</p><h1>Three shots.<br /><i>One standout reel.</i></h1><p className="lede">Shoot or upload three real moments. We’ll turn them into a vertical MP4 that is yours to download.</p><div className="actions"><button className="primary" onClick={() => setScreen("presets")}>Create a reel <Film size={18} /></button><button className="secondary" onClick={() => void loadSamples()}>Try with sample clips <Play size={17} /></button></div><div className="how"><span><b>01</b> Pick a style</span><span><b>02</b> Capture three shots</span><span><b>03</b> Export your reel</span></div></section>}
    {screen === "presets" && <section className="page"><button className="back" onClick={() => setScreen("welcome")}><ChevronLeft size={17} /> Back</button><p className="eyebrow">CHOOSE YOUR CUT</p><h2>What’s the story?</h2><p className="lede">Every preset makes a genuinely different edit. Pick the feeling first.</p><div className="preset-grid">{PRESETS.map((item, index) => <article className={`preset preset-${index + 1}`} key={item.id}><div className="preset-number">0{index + 1}</div><p className="eyebrow">{item.eyebrow}</p><h3>{item.name}</h3><p>{item.description}</p><div className="preset-meta"><span>{item.duration}</span><span>{item.shots[0]}</span></div><button className="card-action" onClick={() => choosePreset(item)}>Choose this style <span>→</span></button></article>)}</div></section>}
    {screen === "record" && <section className="page recording-page"><button className="back" onClick={() => { stopCamera(); setScreen("presets"); }}><ChevronLeft size={17} /> Change preset</button><div className="record-head"><div><p className="eyebrow">{preset.name} · SHOT {activeShot + 1} OF 3</p><h2>{guide}</h2><p className="lede">{challenge ? `Roulette challenge: ${challenge}. ` : ""}Keep it short: 3–8 seconds is ideal.</p></div><button className="roulette" onClick={() => setChallenge(challenges[Math.floor(Math.random() * challenges.length)])}><Shuffle size={17} /> {challenge || "Reel Roulette"}</button></div><div className="shot-progress">{preset.shots.map((shot, i) => <button className={i === activeShot ? "current" : shots[i] ? "done" : ""} onClick={() => { stopCamera(); setActiveShot(i); }} key={shot}><span>{shots[i] ? <Check size={16} /> : i + 1}</span>{shot}</button>)}</div><div className="camera-box">{stream ? <video ref={videoRef} className="camera-live" muted playsInline /> : shots[activeShot] ? <video className="camera-live" src={shots[activeShot]?.previewUrl} controls playsInline /> : <div className="camera-empty"><Camera size={38} /><p>Camera stays off until you choose to open it.</p></div>}{countdown && <div className="countdown">{countdown}</div>}{recording && <div className="recording-dot">● REC {recordSeconds}s</div>}</div>{cameraError && <p className="error">{cameraError}</p>}<input ref={fileInput} type="file" accept="video/mp4,video/webm,video/quicktime,video/x-m4v,video/3gpp" hidden onChange={(event) => event.target.files?.[0] && void uploadFile(event.target.files[0])} /><div className="camera-actions">{!stream && !shots[activeShot] && <button className="primary" disabled={uploading} onClick={() => void openCamera()}><Camera size={18} /> Open camera</button>}{stream && !recording && <><button className="primary" disabled={!!countdown || uploading} onClick={beginRecording}><Video size={18} /> {countdown ? "Get ready…" : "Record shot"}</button><button className="secondary" onClick={() => void switchCamera()}><RefreshCw size={17} /> Flip</button></>}{recording && <button className="stop" onClick={stopRecording}><span /> Stop recording</button>}<button className="secondary" disabled={uploading} onClick={() => fileInput.current?.click()}><Upload size={17} /> {uploading ? "Uploading…" : "Upload video"}</button>{shots[activeShot] && <button className="secondary" onClick={() => { const next = [...shots]; next[activeShot] = undefined; setShots(next); }}><X size={17} /> Retake</button>}</div>{isReady && <button className="continue" onClick={() => { stopCamera(); setScreen("review"); }}>Review three shots <span>→</span></button>}</section>}
    {screen === "review" && <section className="page"><button className="back" onClick={() => setScreen("record")}><ChevronLeft size={17} /> Back to shots</button><p className="eyebrow">READY TO CUT</p><h2>Give the reel its headline.</h2><p className="lede">Your footage stays private by default. Nothing is shown publicly unless you opt in.</p><div className="review-grid"><div className="shot-review">{shots.map((shot, index) => <div key={index}><video src={shot?.previewUrl} controls playsInline /><div><b>Shot {index + 1}</b><span>{shot?.duration}s · {preset.captions[index]}</span></div><button onClick={() => { setActiveShot(index); setScreen("record"); }}>Retake</button></div>)}</div><aside className="export-settings"><label>Opening title<input value={title} maxLength={52} onChange={(event) => setTitle(event.target.value)} /></label><label className="consent"><input checked={publicDisplay} onChange={(event) => setPublicDisplay(event.target.checked)} type="checkbox" /><span><b>Premiere on the festival screen</b><small>Optional. Your reel may be played at this stall.</small></span></label><label className="consent"><input checked={promoReuse} onChange={(event) => setPromoReuse(event.target.checked)} type="checkbox" /><span><b>Allow promotional reuse</b><small>Optional. Separate permission for festival promotion.</small></span></label><p className="privacy">By exporting, you confirm you have permission to upload these faces. Files are stored temporarily and cleaned up by this local demo.</p><button className="primary wide" onClick={() => void generate()}>Generate MP4 <Sparkles size={18} /></button></aside></div></section>}
    {screen === "processing" && <section className="processing"><LoaderCircle className="spin" size={42} /><p className="eyebrow">REAL EXPORT JOB</p><h2>{job?.stage === "failed" ? "Export needs another try" : "Building your reel"}</h2><p className="lede">{job?.stage === "queued" ? "Queued behind another render." : job?.stage === "validating" ? "Checking your three video files." : job?.stage === "preparing" ? "Normalizing vertical video and orientation." : job?.stage === "rendering" ? "Applying your preset’s cuts, effects, and title." : job?.stage === "finalizing" ? "Writing a mobile-ready MP4." : job?.error || "Starting the export job…"}</p>{job?.stage === "failed" && <button className="primary" onClick={() => void generate()}>Retry export</button>}</section>}
    {screen === "preview" && <section className="preview-page"><p className="eyebrow">YOUR REEL IS READY</p><h2>Made from your moments.</h2><div className="final-video"><video src={job?.outputUrl} poster={job?.coverUrl} controls autoPlay playsInline /></div><div className="actions"><a className="primary" href={job?.outputUrl} download={`squad-reel-${preset.id}.mp4`}><Download size={18} /> Download MP4</a><button className="secondary" onClick={() => setScreen("presets")}>Try another preset <RefreshCw size={17} /></button><button className="secondary" onClick={() => { setSessionId(crypto.randomUUID()); setShots([undefined, undefined, undefined]); setActiveShot(0); setJob(undefined); setChallenge(undefined); setTitle(preset.title); setPublicDisplay(false); setPromoReuse(false); setScreen("presets"); }}>Start a new reel</button></div><div className="badges"><span><Check size={16} /> First Reel</span><span><Check size={16} /> Three-Shot Finisher</span>{challenge && <span><Check size={16} /> Challenge Completed</span>}</div>{publicDisplay && <p className="privacy">Big-screen permission recorded for this local session.</p>}{promoReuse && <p className="privacy">Promotional-reuse permission recorded for this local session.</p>}</section>}
  </main>;
}
