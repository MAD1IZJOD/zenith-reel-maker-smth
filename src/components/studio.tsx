"use client";

/* Private, session-scoped FFmpeg cover assets are intentionally served directly rather than through a public image optimizer. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Camera, Check, ChevronLeft, Copy, Download, Film, LoaderCircle, Play, RefreshCw, Share2, Shuffle, Sparkles, Upload, Video, Volume2, VolumeX, X } from "lucide-react";
import { CAPTION_STYLES, defaultCreativeOptions, parseCreativeOptions, VIBES, type CreativeOptions } from "@/lib/creative/options";
import { PRESETS, type ReelPreset } from "@/lib/presets";
import { createStudioAssist } from "@/lib/ai/studio";
import { useCamera } from "@/hooks/use-camera";
import { RetrievalLink } from "@/components/retrieval-link";
import { uploadClip } from "@/lib/camera/upload";
import { CHALLENGES as challenges, type Challenge } from "@/lib/creative/challenges";
import { BattleResult } from "@/components/battle-result";
import { PremiereConsent } from "@/components/premiere-consent";
import { PresetPreview } from "@/components/preset-preview";

type Screen = "welcome" | "presets" | "director" | "record" | "review" | "customize" | "processing" | "preview";
type Shot = { previewUrl: string; duration: number; name: string };
type Job = { id: string; presetId?: string; challengeId?: string; stage: "queued" | "validating" | "preparing" | "rendering" | "finalizing" | "completed" | "failed"; error?: string; outputUrl?: string; coverUrl?: string; coverUrls?: string[]; metrics?: { queueWaitMs?: number; renderDurationMs?: number; completedAt?: number; outputDurationSeconds?: number; outputBytes?: number } };
const screens: Screen[] = ["welcome", "presets", "director", "record", "review", "customize", "processing", "preview"];
const stages: Job["stage"][] = ["queued", "validating", "preparing", "rendering", "finalizing", "completed", "failed"];
const sessionPattern = /^[a-f0-9-]{36}$/i;

function isStoredShot(value: unknown): value is Shot {
  return typeof value === "object" && value !== null && "previewUrl" in value && "duration" in value && "name" in value
    && typeof value.previewUrl === "string" && typeof value.duration === "number" && typeof value.name === "string";
}

function isStoredJob(value: unknown): value is Job {
  return typeof value === "object" && value !== null && "id" in value && "stage" in value && typeof value.id === "string" && stages.includes(value.stage as Job["stage"]);
}

function formatBytes(value?: number): string | undefined {
  if (!value || value < 1) return undefined;
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)} MB` : `${Math.round(value / 1_000)} KB`;
}

export default function Studio({ festival = false }: { festival?: boolean }) {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [preset, setPreset] = useState<ReelPreset>(PRESETS[0]);
  const [sessionId, setSessionId] = useState("");
  const [shots, setShots] = useState<(Shot | undefined)[]>([undefined, undefined, undefined]);
  const [activeShot, setActiveShot] = useState(0);
  const [challenge, setChallenge] = useState<Challenge>();
  const [title, setTitle] = useState(PRESETS[0].title);
  const [creative, setCreative] = useState<CreativeOptions>(() => defaultCreativeOptions(PRESETS[0]));
  const [advancedGuidance, setAdvancedGuidance] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [failedUpload, setFailedUpload] = useState<{ file: File; shot: number }>();
  const [job, setJob] = useState<Job>();
  const [publicDisplay, setPublicDisplay] = useState(false);
  const [promoReuse, setPromoReuse] = useState(false);
  const [renders, setRenders] = useState<Job[]>([]);
  const [selectedCoverUrl, setSelectedCoverUrl] = useState<string>();
  const [shareMessage, setShareMessage] = useState<string>();
  const [restored, setRestored] = useState(false);
  const [restoreProblem, setRestoreProblem] = useState(false);
  const [networkMessage, setNetworkMessage] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const captureInput = useRef<HTMLInputElement>(null);
  const completedJobId = useRef<string | undefined>(undefined);
  const { stream, recording, recordSeconds, countdown, cameraError, setCameraError, openCamera, stopCamera, beginRecording, stopRecording, switchCamera } = useCamera((file, shot) => { void uploadFile(file, shot); }, activeShot);
  async function freshSession() {
    const response = await fetch("/api/sessions", { method: "POST", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("The studio cannot start a session. Check your connection and reload.");
    const data = await response.json(); setSessionId(data.sessionId);
  }
  async function restartSession() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await freshSession(); stopCamera();
      const next = PRESETS[0]; setPreset(next); setShots([undefined, undefined, undefined]); setActiveShot(0); setJob(undefined); setRenders([]); setSelectedCoverUrl(undefined); setChallenge(undefined); setTitle(next.title); setCreative(defaultCreativeOptions(next)); setPublicDisplay(false); setPromoReuse(false); setFailedUpload(undefined); completedJobId.current = undefined; setScreen("presets");
    } catch (error) { setNetworkMessage((error as Error).message); }
    finally { setSubmitting(false); }
  }

  useEffect(() => {
    let cancelled = false;
    async function restoreDraft() {
      const savedSessionId = new URLSearchParams(window.location.search).get("session");
      if (!savedSessionId || !sessionPattern.test(savedSessionId)) {
        try { await freshSession(); } catch (error) { setNetworkMessage((error as Error).message); }
        setRestored(true); return;
      }
      setSessionId(savedSessionId);
      try {
        const response = await fetch(`/api/sessions/${savedSessionId}`);
        if (cancelled) return;
        if (response.status === 401) { await freshSession(); setNetworkMessage("The previous session expired or belongs to another browser. A new session is ready."); return; }
        if (response.status === 404) return;
        if (!response.ok) throw new Error("Session restore failed");
        const { draft } = await response.json() as { draft: Record<string, unknown> };
        const storedPreset = PRESETS.find((item) => item.id === draft.presetId);
        if (storedPreset) { setPreset(storedPreset); setCreative(parseCreativeOptions(draft.creative, storedPreset)); }
        if (typeof draft.title === "string") setTitle(draft.title.slice(0, 52));
        if (typeof draft.activeShot === "number" && draft.activeShot >= 0 && draft.activeShot <= 2) setActiveShot(draft.activeShot);
        if (typeof draft.challenge === "string") setChallenge(challenges.find((item) => item.title === draft.challenge));
        if (typeof draft.publicDisplay === "boolean") setPublicDisplay(draft.publicDisplay);
        if (typeof draft.promoReuse === "boolean") setPromoReuse(draft.promoReuse);
        if (draft.advancedGuidance === true) setAdvancedGuidance(true);
        if (typeof draft.screen === "string" && screens.includes(draft.screen as Screen)) setScreen(draft.screen as Screen);
        if (Array.isArray(draft.shots) && draft.shots.length === 3) setShots(draft.shots.map((shot) => isStoredShot(shot) ? shot : undefined));
        if (isStoredJob(draft.job)) setJob(draft.job);
        if (Array.isArray(draft.renders)) setRenders(draft.renders.filter(isStoredJob));
        if (typeof draft.selectedCoverUrl === "string") setSelectedCoverUrl(draft.selectedCoverUrl);
      } catch { setRestoreProblem(true); setNetworkMessage("Could not restore your session. Check your connection and reload; saved footage stays on the server."); }
      finally { if (!cancelled) setRestored(true); }
    }
    void restoreDraft();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!restored || !sessionId || restoreProblem) return;
    const current = new URL(window.location.href);
    if (current.searchParams.get("session") !== sessionId) {
      current.searchParams.set("session", sessionId);
      window.history.replaceState(null, "", current);
    }
    const timer = window.setTimeout(() => {
      void fetch(`/api/sessions/${sessionId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ screen, presetId: preset.id, shots, activeShot, challenge: challenge?.title, title, creative, advancedGuidance, job, renders, selectedCoverUrl, publicDisplay, promoReuse }), signal: AbortSignal.timeout(15_000) }).then((response) => { if (!response.ok) throw new Error(); }).catch(() => setNetworkMessage("Session save delayed. Keep this page open and check your connection."));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [activeShot, advancedGuidance, challenge, creative, job, preset.id, promoReuse, publicDisplay, renders, restored, restoreProblem, screen, selectedCoverUrl, sessionId, shots, title]);

  useEffect(() => {
    if (videoRef.current && stream) { videoRef.current.srcObject = stream; void videoRef.current.play().catch(() => setCameraError("Tap the preview to start the camera video.")); }
  }, [stream, screen, setCameraError]);
  useEffect(() => { if (screen !== "record") stopCamera(); }, [screen, stopCamera]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    if (uploading || failedUpload || recording) window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [uploading, failedUpload, recording]);
  useEffect(() => {
    if (!job || job.stage === "completed" || job.stage === "failed") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`/api/jobs?id=${job.id}`, { signal: AbortSignal.timeout(15_000) });
        if (response.ok) { const result = await response.json(); if (!cancelled) setJob(result.job); }
        else if (!cancelled && (response.status === 401 || response.status === 404)) setJob({ ...job, stage: "failed", error: "This job or session has expired. Start a new reel." });
      } catch { if (!cancelled) setNetworkMessage("Connection lost. Your export continues on the server; checking again shortly."); }
      if (!cancelled) timer = setTimeout(() => void poll(), 1800);
    };
    timer = setTimeout(() => void poll(), 800);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [job]);
  useEffect(() => {
    if (job?.stage !== "completed" || completedJobId.current === job.id) return;
    completedJobId.current = job.id;
    setScreen("preview");
    setSelectedCoverUrl(job.coverUrl);
    setRenders((current) => current.some((render) => render.id === job.id) ? current : [{ ...job, presetId: job.presetId }, ...current].slice(0, 8));
  }, [job]);
  async function uploadFile(file: File, shotIndex = activeShot) {
    setUploading(true); setUploadProgress(0); setCameraError(undefined); setFailedUpload(undefined);
    try {
      const form = new FormData(); form.append("sessionId", sessionId); form.append("shot", String(shotIndex + 1)); form.append("file", file);
      const data = await uploadClip(form, setUploadProgress);
      setShots((current) => { const next = [...current]; next[shotIndex] = { previewUrl: data.previewUrl, duration: Math.round(data.metadata.duration * 10) / 10, name: file.name }; return next; });
      stopCamera();
      return true;
    } catch (error) { setFailedUpload({ file, shot: shotIndex }); setCameraError(error instanceof Error ? error.message : "Upload failed."); return false; }
    finally { setUploading(false); }
  }
  async function removeShot(shotIndex: number) {
    stopCamera();
    setUploading(true);
    try {
      const response = await fetch(`/api/uploads?sessionId=${sessionId}&shot=${shotIndex + 1}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not clear this shot.");
      setShots((current) => { const next = [...current]; next[shotIndex] = undefined; return next; });
    } catch (error) { setCameraError(error instanceof Error ? error.message : "Could not clear this shot."); }
    finally { setUploading(false); }
  }
  async function loadSamples() {
    setScreen("record"); setUploading(true); setCameraError(undefined);
    try {
      for (let i = 0; i < 3; i += 1) { setActiveShot(i); const response = await fetch(`/samples/shot-${i + 1}.mp4`); if (!response.ok) throw new Error("Sample clip could not be loaded."); const blob = await response.blob(); if (!await uploadFile(new File([blob], `festival-sample-${i + 1}.mp4`, { type: "video/mp4" }), i)) throw new Error("Sample upload failed"); }
      setActiveShot(2); setScreen("review");
    } catch { setCameraError("Sample clips are unavailable. Please upload your own clips."); }
    finally { setUploading(false); }
  }
  async function generate() {
    if (submitting || !shots.every(Boolean)) return;
    setSubmitting(true);
    setScreen("processing");
    try {
    const response = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, presetId: preset.id, title, creative, challengeId: challenge?.id, consent: { publicDisplay, promoReuse } }), signal: AbortSignal.timeout(20_000) });
    const data = await response.json();
    if (!response.ok) { setJob({ id: "", stage: "failed", error: data.error }); return; }
    setJob(data.job);
    } catch { setJob({ id: "", stage: "failed", error: "The server could not be reached. Your clips are saved. Check your connection and retry." }); }
    finally { setSubmitting(false); }
  }
  function recordIntent(event: string, extra: Record<string, string> = {}) { void fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, event, ...extra }) }).catch(() => undefined); }
  function choosePreset(next: ReelPreset) { recordIntent("preset_selected", { presetId: next.id }); setPreset(next); setTitle(next.title); setCreative(defaultCreativeOptions(next)); setAdvancedGuidance(false); setScreen("director"); }
  function drawChallenge(useSuggested = false) { const next = challenges[Math.floor(Math.random() * challenges.length)]; recordIntent("challenge_started", { challengeId: next.id }); if (useSuggested) choosePreset(PRESETS.find((preset) => preset.id === next.presetId)!); setChallenge(next); }
  function changeOrder(index: number, direction: -1 | 1) {
    setCreative((current) => {
      const next = [...current.shotOrder] as [number, number, number];
      const target = index + direction;
      if (target < 0 || target > 2) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, shotOrder: next };
    });
  }
  async function copyPostCaption() {
    try { await navigator.clipboard.writeText(assist.postCaption); setShareMessage("Post caption copied."); }
    catch { setShareMessage("Copy is unavailable here. Select the caption text manually."); }
  }
  async function shareReel() {
    if (!job?.outputUrl) return;
    if (!navigator.share) { setShareMessage("Native sharing is unavailable in this browser. Download the MP4 to share it."); return; }
    try {
      const response = await fetch(job.outputUrl);
      if (!response.ok) throw new Error("The export could not be prepared for sharing.");
      const file = new File([await response.blob()], `squad-reel-${preset.id}.mp4`, { type: "video/mp4" });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ title, text: assist.postCaption, files: [file] });
      else await navigator.share({ title, text: assist.postCaption });
      setShareMessage("Share sheet opened. Your reel remains private unless you choose where to send it.");
    } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) setShareMessage("Sharing could not start. Download the MP4 instead."); }
  }
  const assist = createStudioAssist(preset, { challenge: challenge?.title, vibe: creative.vibe, advanced: advancedGuidance });
  const guide = assist.director[activeShot].direction;
  const isReady = shots.every(Boolean);
  const achievements = [
    isReady && { id: "three-shot-finisher", label: "Three-Shot Finisher" },
    renders.length > 0 && { id: "first-reel", label: "First Reel" },
    renders.some((render) => Boolean(render.challengeId)) && { id: "challenge-complete", label: "Challenge Complete" },
    renders.some((render) => render.presetId === "squad-montage") && { id: "squad-creator", label: "Squad Creator" },
    new Set(renders.map((render) => render.presetId)).size >= 2 && { id: "style-explorer", label: "Style Explorer" },
  ].filter(Boolean) as { id: string; label: string }[];

  if (!restored) return <main><header><button className="brand" disabled><span className="brand-mark">S</span> Squad Reel Studio</button></header><section className="processing"><LoaderCircle className="spin" size={36} /><p className="eyebrow">RESTORING SESSION</p><p className="lede">Checking whether your saved footage and reel are ready.</p></section></main>;

  if (restoreProblem) return <main><section className="page"><h2>Your saved reel is safe.</h2><p className="lede" role="alert">{networkMessage}</p><button className="primary" onClick={() => window.location.reload()}>Retry session recovery</button></section></main>;
  if (!sessionId) return <main><section className="page"><h2>Let’s reconnect.</h2><p className="lede" role="alert">{networkMessage || "The studio needs a connection to start your private session."}</p><button className="primary" onClick={() => void freshSession().catch((error) => setNetworkMessage(error.message))}>Retry connection</button></section></main>;
  return <main>
    {networkMessage && <p className="error network-banner" role="status">{networkMessage} <button className="secondary" onClick={() => setNetworkMessage(undefined)}>Dismiss</button></p>}<header><button className="brand" onClick={() => { stopCamera(true); setScreen("welcome"); }}><span className="brand-mark">S</span> Squad Reel Studio</button>{screen !== "welcome" && <div className="stepper">{["Preset", "Director", "Shots", "Customize", "Export"].map((step, i) => <span className={(screen === "presets" && i === 0) || (screen === "director" && i === 1) || (screen === "record" && i === 2) || (["review", "customize"].includes(screen) && i === 3) || (["processing", "preview"].includes(screen) && i === 4) ? "active" : ""} key={step}>{i + 1} {step}</span>)}</div>}</header>
    {screen === "welcome" && <section className="welcome"><p className="eyebrow">COLLEGE FESTIVAL EDITION</p><h1>{festival ? <>3 Shots.<br /><i>1 Epic Reel.</i></> : <>Three shots.<br /><i>One standout reel.</i></>}</h1><p className="lede">{festival ? "Pick a style, record three moments, and let the studio create your reel." : "Shoot or upload three real moments. We’ll turn them into a vertical MP4 that is yours to download."}</p><div className="actions"><button className="primary" onClick={() => setScreen("presets")}>{festival ? "Start Creating" : "Create a reel"} <Film size={18} /></button><button className="secondary" onClick={() => void loadSamples()}>{festival ? "Try Demo" : "Try with sample clips"} <Play size={17} /></button>{festival && <button className="secondary" onClick={() => drawChallenge(true)}>Reel Battle · Surprise Me</button>}</div><div className="how"><span><b>01</b> Pick a style</span><span><b>02</b> Capture three shots</span><span><b>03</b> Export your reel</span></div><p className="privacy"><a href="/privacy">Privacy and permissions</a> · <a href="/festival">Festival mode</a></p></section>}
    {screen === "presets" && <section className="page"><button className="back" onClick={() => setScreen("welcome")}><ChevronLeft size={17} /> Back</button><p className="eyebrow">CHOOSE YOUR CUT</p><h2>What’s the story?</h2><p className="lede">Every preset makes a genuinely different edit. Pick the feeling first.</p><div className="preset-grid">{PRESETS.map((item, index) => <article className={`preset preset-${index + 1}`} key={item.id}><div className="preset-number">0{index + 1}</div><p className="eyebrow">{item.eyebrow}</p><h3>{item.name}</h3><p>{item.description}</p><PresetPreview id={item.id} name={item.name} /><div className="preset-meta"><span>{item.duration}</span><span>{item.shots[0]}</span></div><button className="card-action" onClick={() => choosePreset(item)}>Choose this style <span>→</span></button></article>)}</div></section>}
    {screen === "director" && <section className="page director-page"><button className="back" onClick={() => setScreen("presets")}><ChevronLeft size={17} /> Change preset</button><p className="eyebrow">YOUR SHOT PLAN</p><h2>Here’s your three-shot plan.</h2><p className="lede">Choose a vibe, then capture one clear action per shot. Your challenge will shape the plan.</p><div className="director-controls"><div><span className="control-label">Creative vibe</span><div className="choice-row">{VIBES.map((vibe) => <button key={vibe} className={creative.vibe === vibe ? "choice active-choice" : "choice"} onClick={() => setCreative((current) => ({ ...current, vibe }))}>{vibe}</button>)}</div></div><div className="director-actions"><button className="secondary" onClick={() => setAdvancedGuidance((current) => !current)}>{advancedGuidance ? "Simple guidance" : "More filming detail"}</button><button className="roulette" onClick={() => drawChallenge()}><Shuffle size={17} /> {challenge?.title || "Surprise me"}</button></div></div>{challenge && <p className="challenge-note"><b>{challenge.title}</b> · {challenge.description} <small>{challenge.requirements} Recommended: {PRESETS.find((item) => item.id === challenge.presetId)?.name} · {challenge.difficulty}</small>{challenge.presetId !== preset.id && <button className="challenge-style" onClick={() => { const suggested = PRESETS.find((item) => item.id === challenge.presetId)!; setPreset(suggested); setTitle(suggested.title); setCreative(defaultCreativeOptions(suggested)); }}>Use recommended style</button>}</p>}<div className="director-grid">{assist.director.map((shot, index) => <article className="director-shot" key={shot.title}><span>0{index + 1}</span><h3>{shot.title}</h3><p>{shot.direction}</p><dl><div><dt>Angle</dt><dd>{shot.angle}</dd></div><div><dt>Length</dt><dd>{shot.duration}</dd></div>{advancedGuidance && <div><dt>Example</dt><dd>{shot.example}</dd></div>}</dl></article>)}</div><div className="actions"><button className="primary" onClick={() => { setCreative((current) => ({ ...current, hook: assist.hook })); setScreen("record"); }}>Use this shot plan <Camera size={18} /></button></div></section>}
    {screen === "record" && <section className="page recording-page"><button className="back" onClick={() => { stopCamera(true); setScreen("director"); }}><ChevronLeft size={17} /> Back to shot plan</button><div className="record-head"><div><p className="eyebrow">{preset.name} · SHOT {activeShot + 1} OF 3</p><h2>{guide}</h2><p className="lede">{challenge ? `Roulette challenge: ${challenge.title}. ` : ""}Aim for 3–8 seconds. Camera recordings are silent; uploads can keep their sound.</p></div><button className="roulette" onClick={() => drawChallenge()}><Shuffle size={17} /> {challenge?.title || "Reel Roulette"}</button></div><div className="shot-progress">{preset.shots.map((shot, i) => <button className={i === activeShot ? "current" : shots[i] ? "done" : ""} onClick={() => { stopCamera(true); setActiveShot(i); }} key={shot}><span>{shots[i] ? <Check size={16} /> : i + 1}</span>{shot}</button>)}</div><div className="camera-box">{stream ? <video ref={videoRef} className="camera-live" muted playsInline /> : shots[activeShot] ? <video className="camera-live" src={shots[activeShot]?.previewUrl} controls playsInline /> : <div className="camera-empty"><Camera size={38} /><p>Camera stays off until you choose to open it.</p></div>}{countdown && <div className="countdown">{countdown}</div>}{recording && <div className="recording-dot">● REC {recordSeconds}s</div>}</div>{uploading && <p role="status" className="privacy">{uploadProgress < 100 ? `Uploading ${uploadProgress}%` : "Checking and preparing clip…"}</p>}{cameraError && <p role="alert" className="error">{cameraError}</p>}{failedUpload && <button className="secondary" disabled={uploading} onClick={() => void uploadFile(failedUpload.file, failedUpload.shot)}>Retry saved upload</button>}<input ref={captureInput} type="file" accept="video/*" capture="environment" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadFile(file); }} /><input ref={fileInput} type="file" accept="video/*" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadFile(file); }} /><div className="camera-actions">{!stream && !shots[activeShot] && <button className="primary" disabled={uploading} onClick={() => { void fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, event: "camera_selected" }) }).catch(() => undefined); void openCamera(); }}><Camera size={18} /> Open camera</button>}{stream && !recording && <><button className="primary" disabled={!!countdown || uploading} onClick={beginRecording}><Video size={18} /> {countdown ? "Get ready…" : "Record shot"}</button><button className="secondary" disabled={!!countdown || uploading} onClick={() => void switchCamera()}><RefreshCw size={17} /> Flip</button></>}{recording && <button className="stop" onClick={stopRecording}><span /> Stop recording</button>}<button className="secondary" disabled={uploading} onClick={() => { void fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, event: "upload_selected" }) }).catch(() => undefined); fileInput.current?.click(); }}><Upload size={17} /> {uploading ? "Uploading…" : "Upload video"}</button><button className="secondary" disabled={uploading || recording} onClick={() => captureInput.current?.click()}>Use phone camera</button>{stream && <button className="secondary" onClick={() => stopCamera()}>{recording ? "Cancel recording" : "Close camera"}</button>}{shots[activeShot] && <button className="secondary" disabled={uploading} onClick={() => void removeShot(activeShot)}><X size={17} /> Retake</button>}</div>{isReady && <button className="continue" onClick={() => { stopCamera(true); setScreen("review"); }}>Review three shots <span>→</span></button>}</section>}
    {screen === "review" && <section className="page"><button className="back" onClick={() => setScreen("record")}><ChevronLeft size={17} /> Back to shots</button><p className="eyebrow">FOOTAGE REVIEW</p><h2>Your three moments are saved.</h2><p className="lede">Preview each shot, replace anything you do not like, then choose how the edit should feel.</p><div className="review-grid"><div className="shot-review">{shots.map((shot, index) => <div key={index}><video src={shot?.previewUrl} controls playsInline /><div><b>Shot {index + 1}</b><span>{shot?.duration}s · {creative.captions[index]}</span></div><button onClick={() => { setActiveShot(index); setScreen("record"); }}>Replace</button></div>)}</div><aside className="export-settings"><p className="eyebrow">{preset.name}</p><h3>Ready for the creative pass?</h3><p className="privacy">Your footage is private by default. The next step lets you choose the hook, captions, order, and sound.</p><button className="primary wide" onClick={() => setScreen("customize")}>Customize reel <Sparkles size={18} /></button></aside></div></section>}
    {screen === "customize" && <section className="page customize-page"><button className="back" onClick={() => setScreen("review")}><ChevronLeft size={17} /> Back to footage</button><p className="eyebrow">CUSTOMIZE THE CUT</p><h2>Make the story yours.</h2><p className="lede">Your title, captions, shot order, and sound will be included in the MP4.</p><div className="customize-grid"><div className="customize-main"><section className="settings-section"><label className="field-label">Reel title<input value={title} maxLength={52} onChange={(event) => setTitle(event.target.value)} /></label><span className="control-label">Opening hook</span><div className="hook-options">{assist.hookOptions.map((hook) => <button className={creative.hook === hook ? "hook-option active-choice" : "hook-option"} key={hook} onClick={() => setCreative((current) => ({ ...current, hook }))}>{hook}</button>)}</div><label className="field-label">Or write your own hook<input value={creative.hook} maxLength={52} onChange={(event) => setCreative((current) => ({ ...current, hook: event.target.value }))} /></label></section><section className="settings-section"><span className="control-label">Caption style</span><div className="choice-row">{CAPTION_STYLES.map((style) => <button className={creative.captionStyle === style ? "choice active-choice" : "choice"} key={style} onClick={() => setCreative((current) => ({ ...current, captionStyle: style }))}>{style}</button>)}</div><div className="caption-fields">{creative.captions.map((caption, index) => <label className="field-label" key={index}>Shot {index + 1} overlay<input value={caption} maxLength={44} onChange={(event) => setCreative((current) => { const captions = [...current.captions] as [string, string, string]; captions[index] = event.target.value; return { ...current, captions }; })} /></label>)}</div></section><section className="settings-section"><span className="control-label">Shot order</span><p className="privacy">Change the order of your saved shots.</p><div className="order-list">{creative.shotOrder.map((shotIndex, index) => <div key={`${shotIndex}-${index}`}><span>0{index + 1}</span><b>Recorded shot {shotIndex + 1}</b><div><button aria-label={`Move recorded shot ${shotIndex + 1} earlier`} disabled={index === 0} onClick={() => changeOrder(index, -1)}><ArrowUp size={16} /></button><button aria-label={`Move recorded shot ${shotIndex + 1} later`} disabled={index === 2} onClick={() => changeOrder(index, 1)}><ArrowDown size={16} /></button></div></div>)}</div></section></div><aside className="export-settings"><span className="control-label">Sound</span><button className={creative.audioMode === "muted" ? "sound-option active-choice" : "sound-option"} onClick={() => setCreative((current) => ({ ...current, audioMode: "muted" }))}><VolumeX size={18} /><span><b>Muted</b><small>Reliable, music-free export.</small></span></button><button className={creative.audioMode === "original" ? "sound-option active-choice" : "sound-option"} onClick={() => setCreative((current) => ({ ...current, audioMode: "original" }))}><Volume2 size={18} /><span><b>Original clip audio</b><small>Uses available clip sound with safe volume normalization.</small></span></button><p className="privacy">By exporting, you confirm you have permission to upload these faces. Files stay private in temporary studio storage. Public-screen permission is requested separately after you review the result.</p><button className="primary wide" disabled={submitting || !sessionId} onClick={() => void generate()}>Generate MP4 <Sparkles size={18} /></button></aside></div></section>}
    {screen === "processing" && <section className="processing"><LoaderCircle className="spin" size={42} /><p className="eyebrow">EXPORTING YOUR REEL</p><h2>{job?.stage === "failed" ? "Export needs another try" : "Building your reel"}</h2><p className="lede">{job?.stage === "queued" ? "Queued behind another render." : job?.stage === "validating" ? "Checking your three video files." : job?.stage === "preparing" ? "Normalizing vertical video and orientation." : job?.stage === "rendering" ? "Applying your preset’s cuts, effects, and title." : job?.stage === "finalizing" ? "Writing a mobile-ready MP4." : job?.error || "Starting the export job…"}</p>{job?.stage === "failed" && <button className="primary" onClick={() => void generate()}>Retry export</button>}</section>}
    {screen === "preview" && <section className="preview-page"><p className="eyebrow">{shots.every((shot) => shot?.name.startsWith("festival-sample-")) ? "SAMPLE FOOTAGE · REAL EXPORT" : "YOUR REEL IS READY"}</p><h2>Made from your moments.</h2><div className="final-video"><video src={job?.outputUrl} poster={selectedCoverUrl || job?.coverUrl} controls autoPlay playsInline /></div>{job?.metrics && <p className="export-meta">{job.metrics.outputDurationSeconds?.toFixed(1)} sec · 720 × 1280 · H.264/AAC{formatBytes(job.metrics.outputBytes) ? ` · ${formatBytes(job.metrics.outputBytes)}` : ""}</p>}<div className="actions"><a className="primary" href={job?.outputUrl ? `${job.outputUrl}?download=1` : undefined} download={`squad-reel-${preset.id}.mp4`}><Download size={18} /> Download MP4</a><button className="secondary" onClick={() => void shareReel()}><Share2 size={17} /> Share</button><button className="secondary" onClick={() => void copyPostCaption()}><Copy size={17} /> Copy caption</button><button className="secondary" onClick={() => setScreen("presets")}>Try another preset <RefreshCw size={17} /></button><button className="secondary" disabled={submitting} onClick={() => void restartSession()}>Start a new reel</button></div>{shareMessage && <p className="share-message">{shareMessage}</p>}{job?.id && <><BattleResult key={`battle-${job.id}`} jobId={job.id} /><PremiereConsent key={`premiere-${job.id}`} jobId={job.id} /><RetrievalLink key={job.id} jobId={job.id} /></>}<section className="cover-picker"><span className="control-label">Pick a reel cover</span><p className="privacy">Three frames from your reel, with your title.</p><div>{job?.coverUrls?.map((cover, index) => <button className={selectedCoverUrl === cover ? "cover-choice selected-cover" : "cover-choice"} key={cover} onClick={() => setSelectedCoverUrl(cover)}><img src={cover} alt={`Cover option ${index + 1}`} /><span>Frame {index + 1}</span></button>)}</div>{selectedCoverUrl && <a className="secondary" href={selectedCoverUrl} download={`squad-reel-cover-${preset.id}.jpg`}><Download size={16} /> Download cover</a>}</section>{renders.length > 1 && <section className="previous-renders"><span className="control-label">Earlier versions</span>{renders.slice(1).map((render) => <a key={render.id} href={`${render.outputUrl}?download=1`} download={`squad-reel-${render.presetId || "version"}.mp4`}>Download {PRESETS.find((item) => item.id === render.presetId)?.name || "previous reel"}</a>)}</section>}<div className="badges">{achievements.map((achievement) => <span key={achievement.id}><Check size={16} /> {achievement.label}</span>)}</div></section>}
  </main>;
}
