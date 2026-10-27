"use client";
import { RegistrationGate } from "@/components/registration-gate";

/* Private, session-scoped FFmpeg cover assets are intentionally served directly rather than through a public image optimizer. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { AgentCrew } from "@/components/creative/agent-crew";
import { ShotCoach } from "@/components/creative/shot-coach";
import { Landing } from "@/components/creative/landing";
import type { StudioShot, StudioJob } from "@/types/studio";
const FinishingStudio = dynamic(() => import("@/components/creative/finishing-studio").then((module) => module.FinishingStudio));
const RemixLab = dynamic(() => import("@/components/creative/remix-lab").then((module) => module.RemixLab));
const Storyboard = dynamic(() => import("@/components/creative/storyboard"), { ssr: false, loading: () => <div className="storyboard-loading">Opening your storyboard…</div> });
import { Camera, Check, ChevronLeft, Copy, Download, LoaderCircle, RefreshCw, Share2, Shuffle, Sparkles, Upload, Video, X } from "lucide-react";
import { defaultCreativeOptions, parseCreativeOptions, VIBES, type CreativeOptions } from "@/lib/creative/options";
import { PRESETS, type ReelPreset } from "@/lib/presets";
import { createStudioAssist } from "@/lib/ai/studio";
import { useCamera } from "@/hooks/use-camera";
import { RetrievalLink } from "@/components/retrieval-link";
import { uploadClip } from "@/lib/camera/upload";
import { CHALLENGES as challenges, type Challenge } from "@/lib/creative/challenges";
import { BattleResult } from "@/components/battle-result";
import { PremiereConsent } from "@/components/premiere-consent";
import { PresetPreview } from "@/components/preset-preview";
import { ping, settle } from "@/lib/client/http";
import { posterFrame } from "@/lib/client/media";
import type { DirectorPlan } from "@/components/creative/finishing-studio";

type Screen = "welcome" | "presets" | "director" | "record" | "review" | "customize" | "processing" | "preview" | "remix";
type Shot = StudioShot;
type Job = StudioJob;
const screens: Screen[] = ["welcome", "presets", "director", "record", "review", "customize", "processing", "preview", "remix"];
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

const noSubscription = () => () => undefined;
const inPageCameraSupported = () => window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";

export default function Studio({ festival = false, podcastEnabled = false }: { festival?: boolean; podcastEnabled?: boolean }) {
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
  const [remixJob, setRemixJob] = useState<Job>();
  const [favoriteId, setFavoriteId] = useState<string>();
  const [publicDisplay, setPublicDisplay] = useState(false);
  const [promoReuse, setPromoReuse] = useState(false);
  const [renders, setRenders] = useState<Job[]>([]);
  const [selectedCoverUrl, setSelectedCoverUrl] = useState<string>();
  const [shareMessage, setShareMessage] = useState<string>();
  const [restored, setRestored] = useState(false);
  const [restoreProblem, setRestoreProblem] = useState(false);
  const [networkMessage, setNetworkMessage] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [plan, setPlan] = useState<DirectorPlan>();
  const [planning, setPlanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const captureInput = useRef<HTMLInputElement>(null);
  // Plain-HTTP addresses (for example a laptop's Wi-Fi IP) cannot open the camera inside the page; the phone's own camera app still can.
  const inPageCamera = useSyncExternalStore(noSubscription, inPageCameraSupported, () => true);
  // The draft not yet sent to the server, and the shots it last saved: new shots are saved at once, not debounced.
  const pendingDraft = useRef<{ url: string; body: string }>(undefined);
  const savedShots = useRef(shots);
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
      const next = PRESETS[0]; setPreset(next); setShots([undefined, undefined, undefined]); setActiveShot(0); setJob(undefined); setRemixJob(undefined); setFavoriteId(undefined); setRenders([]); setSelectedCoverUrl(undefined); setChallenge(undefined); setTitle(next.title); setCreative(defaultCreativeOptions(next)); setPublicDisplay(false); setPromoReuse(false); setFailedUpload(undefined); completedJobId.current = undefined; setScreen("presets");
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
        if (isStoredJob(draft.remixJob)) setRemixJob(draft.remixJob);
        if (typeof draft.favoriteId === "string") setFavoriteId(draft.favoriteId);
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
    const draft = { url: `/api/sessions/${sessionId}`, body: JSON.stringify({ screen, presetId: preset.id, shots, activeShot, challenge: challenge?.title, title, creative, advancedGuidance, job, remixJob, favoriteId, renders, selectedCoverUrl, publicDisplay, promoReuse }) };
    pendingDraft.current = draft;
    // A finished upload is saved immediately so a refresh (or a phone discarding the tab) cannot lose that shot.
    const delay = savedShots.current === shots ? 350 : 0;
    savedShots.current = shots;
    const timer = window.setTimeout(() => {
      if (pendingDraft.current === draft) pendingDraft.current = undefined;
      void fetch(draft.url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: draft.body, signal: AbortSignal.timeout(15_000) }).then(settle).then((response) => { if (!response.ok) throw new Error(); }).catch(() => setNetworkMessage("Session save delayed. Keep this page open and check your connection."));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [activeShot, advancedGuidance, challenge, creative, job, remixJob, favoriteId, preset.id, promoReuse, publicDisplay, renders, restored, restoreProblem, screen, selectedCoverUrl, sessionId, shots, title]);

  useEffect(() => {
    // Leaving or reloading the page sends any draft still waiting for its debounce; keepalive outlives the page.
    const flush = () => {
      const draft = pendingDraft.current; if (!draft) return;
      pendingDraft.current = undefined;
      void fetch(draft.url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: draft.body, keepalive: true }).then(settle).catch(() => undefined);
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

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
    setScreen((current) => current === "remix" ? current : "preview");
    setSelectedCoverUrl(job.coverUrl);
    setRenders((current) => current.some((render) => render.id === job.id) ? current : [{ ...job, presetId: job.presetId }, ...current].slice(0, 8));
  }, [job]);
  useEffect(() => {
    if (remixJob?.stage === "completed") setRenders((current) => current.some((render) => render.id === remixJob.id) ? current : [remixJob, ...current].slice(0, 8));
  }, [remixJob]);
  async function uploadFile(file: File, shotIndex = activeShot) {
    setUploading(true); setUploadProgress(0); setCameraError(undefined); setFailedUpload(undefined);
    try {
      const form = new FormData(); form.append("sessionId", sessionId); form.append("shot", String(shotIndex + 1)); form.append("file", file);
      const data = await uploadClip(form, setUploadProgress);
      setShots((current) => { const next = [...current]; next[shotIndex] = { previewUrl: data.previewUrl, duration: Math.round(data.metadata.duration * 10) / 10, name: file.name, analysis: data.analysis }; return next; });
      setCreative((current) => { const trimStarts = [...current.trimStarts] as [number, number, number]; trimStarts[shotIndex] = 0; return { ...current, trimStarts }; });
      stopCamera();
      return true;
    } catch (error) { setFailedUpload({ file, shot: shotIndex }); setCameraError(error instanceof Error ? error.message : "Upload failed."); return false; }
    finally { setUploading(false); }
  }
  async function removeShot(shotIndex: number) {
    stopCamera();
    setUploading(true);
    try {
      const response = await settle(await fetch(`/api/uploads?sessionId=${sessionId}&shot=${shotIndex + 1}`, { method: "DELETE" }));
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
  async function askDirector() {
    if (planning) return;
    setPlanning(true);
    try {
      const response = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, presetId: preset.id, vibe: creative.vibe, challenge: challenge?.title }), signal: AbortSignal.timeout(80_000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The Director is unavailable. Your settings are unchanged.");
      setCreative((current) => ({ ...current, ...data.patch }));
      setPlan({ source: data.source, rationale: data.rationale, model: data.model, latencyMs: data.latencyMs, fallbackReason: data.fallbackReason, hookOptions: data.hookOptions });
    } catch (error) { setNetworkMessage((error as Error).name === "TimeoutError" ? "The Director took too long. Your settings are unchanged." : (error as Error).message); }
    finally { setPlanning(false); }
  }
  async function generate() {
    if (submitting || !shots.every(Boolean)) return;
    setSubmitting(true);
    setJob(undefined);
    setScreen("processing");
    try {
    const response = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, presetId: preset.id, title, creative, challengeId: challenge?.id, consent: { publicDisplay, promoReuse } }), signal: AbortSignal.timeout(20_000) });
    const data = await response.json();
    if (!response.ok) { setJob({ id: "", stage: "failed", error: data.error }); return; }
    setJob(data.job);
    } catch { setJob({ id: "", stage: "failed", error: "The server could not be reached. Your clips are saved. Check your connection and retry." }); }
    finally { setSubmitting(false); }
  }
  function recordIntent(event: string, extra: Record<string, string> = {}) { ping("/api/events", { sessionId, event, ...extra }); }
  function choosePreset(next: ReelPreset) { recordIntent("preset_selected", { presetId: next.id }); setPreset(next); setTitle(next.title); setCreative(defaultCreativeOptions(next)); setAdvancedGuidance(false); setScreen("director"); }
  function drawChallenge(useSuggested = false) { const next = challenges[Math.floor(Math.random() * challenges.length)]; recordIntent("challenge_started", { challengeId: next.id }); if (useSuggested) choosePreset(PRESETS.find((preset) => preset.id === next.presetId)!); setChallenge(next); }
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
      const file = new File([await response.blob()], `zenith-reel-${preset.id}.mp4`, { type: "video/mp4" });
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

  if (!restored) return <main><header><button className="brand" disabled><span className="brand-mark">Z</span> ZENITH REEL</button></header><section className="processing"><LoaderCircle className="spin" size={36} /><p className="eyebrow">RESTORING SESSION</p><p className="lede">Checking whether your saved footage and reel are ready.</p></section></main>;

  if (restoreProblem) return <main><section className="page"><h2>Your saved reel is safe.</h2><p className="lede" role="alert">{networkMessage}</p><button className="primary" onClick={() => window.location.reload()}>Retry session recovery</button></section></main>;
  if (!sessionId) return <main><section className="page"><h2>Let’s reconnect.</h2><p className="lede" role="alert">{networkMessage || "The studio needs a connection to start your private session."}</p><button className="primary" onClick={() => void freshSession().catch((error) => setNetworkMessage(error.message))}>Retry connection</button></section></main>;
  return <RegistrationGate key={sessionId} sessionId={sessionId}><main>
    {networkMessage && <p className="error network-banner" role="status">{networkMessage} <button className="secondary" onClick={() => setNetworkMessage(undefined)}>Dismiss</button></p>}<header><button className="brand" onClick={() => { stopCamera(true); setScreen("welcome"); }}><span className="brand-mark">Z</span> ZENITH REEL</button>{screen !== "welcome" && <div className="stepper">{["Preset", "Director", "Shots", "Customize", "Export"].map((step, i) => <span className={(screen === "presets" && i === 0) || (screen === "director" && i === 1) || (screen === "record" && i === 2) || (["review", "customize"].includes(screen) && i === 3) || (["processing", "preview", "remix"].includes(screen) && i === 4) ? "active" : ""} key={step}>{i + 1} {step}</span>)}</div>}</header>
    {screen === "welcome" && <Landing festival={festival} podcastEnabled={podcastEnabled} onCreate={() => setScreen("presets")} onDemo={() => void loadSamples()} onBattle={() => drawChallenge(true)} />}
    {screen === "presets" && <section className="page"><button className="back" onClick={() => setScreen("welcome")}><ChevronLeft size={17} /> Back</button><p className="eyebrow">CHOOSE YOUR CUT</p><h2>What’s the story?</h2><p className="lede">Every preset makes a genuinely different edit. Pick the feeling first.</p><p className="privacy preset-credit">Sample edits use footage from <i>Tears of Steel</i> © Blender Foundation, CC BY 3.0.</p><div className="preset-grid">{PRESETS.map((item, index) => <article className={`preset preset-${index + 1}`} key={item.id}><div className="preset-number">0{index + 1}</div><p className="eyebrow">{item.eyebrow}</p><h3>{item.name}</h3><p>{item.description}</p><PresetPreview id={item.id} name={item.name} /><div className="preset-meta"><span>{item.duration}</span><span>{item.shots[0]}</span></div><button className="card-action" onClick={() => choosePreset(item)}>Choose this style <span>→</span></button></article>)}</div></section>}
    {screen === "director" && <section className="page director-page"><button className="back" onClick={() => setScreen("presets")}><ChevronLeft size={17} /> Change preset</button><p className="eyebrow">YOUR SHOT PLAN</p><h2>Here’s your three-shot plan.</h2><p className="lede">Choose a vibe, then capture one clear action per shot. Your challenge will shape the plan.</p><div className="director-controls"><div><span className="control-label">Creative vibe</span><div className="choice-row">{VIBES.map((vibe) => <button key={vibe} className={creative.vibe === vibe ? "choice active-choice" : "choice"} onClick={() => setCreative((current) => ({ ...current, vibe }))}>{vibe}</button>)}</div></div><div className="director-actions"><button className="secondary" onClick={() => setAdvancedGuidance((current) => !current)}>{advancedGuidance ? "Simple guidance" : "More filming detail"}</button><button className="roulette" onClick={() => drawChallenge()}><Shuffle size={17} /> {challenge?.title || "Surprise me"}</button></div></div>{challenge && <p className="challenge-note"><b>{challenge.title}</b> · {challenge.description} <small>{challenge.requirements} Recommended: {PRESETS.find((item) => item.id === challenge.presetId)?.name} · {challenge.difficulty}</small>{challenge.presetId !== preset.id && <button className="challenge-style" onClick={() => { const suggested = PRESETS.find((item) => item.id === challenge.presetId)!; setPreset(suggested); setTitle(suggested.title); setCreative(defaultCreativeOptions(suggested)); }}>Use recommended style</button>}</p>}<Storyboard shots={shots} order={creative.shotOrder} guides={assist.director} active={activeShot} onSelect={setActiveShot} onCapture={(index) => { setActiveShot(index); setScreen("record"); }} /><div className="actions"><button className="primary" onClick={() => { setCreative((current) => ({ ...current, hook: assist.hook })); setScreen("record"); }}>Use this shot plan <Camera size={18} /></button></div></section>}
    {screen === "record" && <section className="page recording-page"><button className="back" onClick={() => { stopCamera(true); setScreen("director"); }}><ChevronLeft size={17} /> Back to shot plan</button><div className="record-head"><div><p className="eyebrow">{preset.name} · SHOT {activeShot + 1} OF 3</p><h2>{guide}</h2><p className="lede">{challenge ? `Roulette challenge: ${challenge.title}. ` : ""}Aim for 3–8 seconds. Camera recordings are silent; uploads can keep their sound.</p></div><button className="roulette" onClick={() => drawChallenge()}><Shuffle size={17} /> {challenge?.title || "Reel Roulette"}</button></div><div className="shot-progress">{preset.shots.map((shot, i) => <button className={i === activeShot ? "current" : shots[i] ? "done" : ""} onClick={() => { stopCamera(true); setActiveShot(i); }} key={shot}><span>{shots[i] ? <Check size={16} /> : i + 1}</span>{shot}</button>)}</div><div className="camera-box">{stream ? <video ref={videoRef} className="camera-live" muted playsInline /> : shots[activeShot] ? <video className="camera-live" src={posterFrame(shots[activeShot]?.previewUrl)} controls playsInline preload="metadata" /> : <div className="camera-empty"><Camera size={38} /><p>{inPageCamera ? "Camera stays off until you choose to open it." : "Tap Use phone camera to record with your camera app, or upload a video."}</p></div>}{countdown && <div className="countdown">{countdown}</div>}{recording && <div className="recording-dot">● REC {recordSeconds}s</div>}</div><ShotCoach analysis={shots[activeShot]?.analysis} recommendedSeconds={preset.clipSeconds} />{uploading && <p role="status" className="privacy">{uploadProgress < 0 ? "The studio is busy with other clips. Yours is next in line…" : uploadProgress < 100 ? `Uploading ${uploadProgress}%` : "Checking and preparing clip…"}</p>}{cameraError && <p role="alert" className="error">{cameraError}</p>}{failedUpload && <button className="secondary" disabled={uploading} onClick={() => void uploadFile(failedUpload.file, failedUpload.shot)}>Retry saved upload</button>}<input ref={captureInput} type="file" accept="video/*" capture="environment" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadFile(file); }} /><input ref={fileInput} type="file" accept="video/*" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadFile(file); }} /><div className="camera-actions">{!stream && !shots[activeShot] && inPageCamera && <button className="primary" disabled={uploading} onClick={() => { recordIntent("camera_selected"); void openCamera(); }}><Camera size={18} /> Open camera</button>}{stream && !recording && <><button className="primary" disabled={!!countdown || uploading} onClick={beginRecording}><Video size={18} /> {countdown ? "Get ready…" : "Record shot"}</button><button className="secondary" disabled={!!countdown || uploading} onClick={() => void switchCamera()}><RefreshCw size={17} /> Flip</button></>}{recording && <button className="stop" onClick={stopRecording}><span /> Stop recording</button>}<button className="secondary" disabled={uploading} onClick={() => { recordIntent("upload_selected"); fileInput.current?.click(); }}><Upload size={17} /> {uploading ? "Uploading…" : "Upload video"}</button><button className={inPageCamera || shots[activeShot] ? "secondary" : "primary"} disabled={uploading || recording} onClick={() => captureInput.current?.click()}>Use phone camera</button>{stream && <button className="secondary" onClick={() => stopCamera()}>{recording ? "Cancel recording" : "Close camera"}</button>}{shots[activeShot] && <button className="secondary" disabled={uploading} onClick={() => void removeShot(activeShot)}><X size={17} /> Retake</button>}</div>{isReady && <button className="continue" onClick={() => { stopCamera(true); setScreen("review"); }}>Review three shots <span>→</span></button>}</section>}
    {screen === "review" && <section className="page review-page"><button className="back" onClick={() => setScreen("record")}><ChevronLeft size={17} /> Back to shots</button><p className="eyebrow">FOOTAGE REVIEW</p><h2>Your three moments are saved.</h2><p className="lede">Preview each shot, replace anything you do not like, then choose how the edit should feel.</p><div className="review-grid"><div className="review-main"><Storyboard compact shots={shots} order={creative.shotOrder} guides={assist.director} active={activeShot} onSelect={setActiveShot} /><div className="shot-review">{shots.map((shot, index) => <div key={index}><video src={posterFrame(shot?.previewUrl)} controls playsInline preload="metadata" /><div><b>Shot {index + 1}</b><span>{shot?.duration}s · {creative.captions[index]}</span></div><button onClick={() => { setActiveShot(index); setScreen("record"); }}>Replace</button></div>)}</div></div><aside className="export-settings"><p className="eyebrow">{preset.name}</p><h3>Ready for the creative pass?</h3><p className="privacy">Your footage is private by default. The next step lets you choose the hook, captions, order, and sound.</p><button className="primary wide" onClick={() => setScreen("customize")}>Customize reel <Sparkles size={18} /></button></aside></div></section>}
    {screen === "customize" && <section className="page customize-page"><button className="back" onClick={() => setScreen("review")}><ChevronLeft size={17} /> Back to footage</button><p className="eyebrow">REEL FINISHING STUDIO</p><h2>Make the final cut.</h2><p className="lede">A little direction makes it yours. Your changes become the real export.</p><FinishingStudio preset={preset} shots={shots} options={creative} onChange={setCreative} title={title} onTitle={setTitle} assist={assist} onReplace={(index) => { setActiveShot(index); setScreen("record"); }} onGenerate={() => void generate()} submitting={submitting} previous={renders[0]} plan={plan} planning={planning} onPlan={() => void askDirector()} /></section>}
    {screen === "processing" && <section className="processing">{job?.stage !== "failed" && <LoaderCircle className="spin" size={42} />}<p className="eyebrow">EXPORTING YOUR REEL</p><h2>{job?.stage === "failed" ? "Export needs another try" : "Building your reel"}</h2><p className="lede">{job?.stage === "queued" ? "Queued behind another render." : job?.stage === "validating" ? "Checking your three video files." : job?.stage === "preparing" ? (creative.captionMode === "speech" ? "Transcribing speech for captions and planning cuts." : "Planning cuts from your measured footage.") : job?.stage === "rendering" ? "Rendering framing, grade, transitions, titles and sound in one pass." : job?.stage === "finalizing" ? "Checking the MP4 and your three cover frames." : job?.error || "Starting the export job…"}</p><AgentCrew stage={job?.stage} presetName={preset.name} />{job?.stage === "failed" && <div className="actions"><button className="primary" disabled={submitting} onClick={() => void generate()}>Retry export</button><button className="secondary" onClick={() => setScreen("customize")}>Review edit settings</button></div>}</section>}
    {screen === "remix" && job && <RemixLab sessionId={sessionId} original={job} candidate={remixJob} onCandidate={setRemixJob} favoriteId={favoriteId} onFavorite={setFavoriteId} onBack={() => setScreen("preview")} />}
    {screen === "preview" && <section className="preview-page"><p className="eyebrow">{shots.every((shot) => shot?.name.startsWith("festival-sample-")) ? "SAMPLE FOOTAGE · REAL EXPORT" : "YOUR REEL IS READY"}</p><h2>Made from your moments.</h2><div className="final-video"><video src={job?.outputUrl} poster={selectedCoverUrl || job?.coverUrl} controls autoPlay playsInline /></div>{job?.metrics && <p className="export-meta">{job.metrics.outputDurationSeconds?.toFixed(1)} sec · {job.metrics.width || 720} × {job.metrics.height || 1280} · H.264/AAC{job.metrics.renderDurationMs ? ` · rendered in ${(job.metrics.renderDurationMs / 1000).toFixed(1)}s` : ""}{formatBytes(job.metrics.outputBytes) ? ` · ${formatBytes(job.metrics.outputBytes)}` : ""}</p>}<div className="actions"><a className="primary" href={job?.outputUrl ? `${job.outputUrl}?download=1` : undefined} download={`zenith-reel-${preset.id}.mp4`}><Download size={18} /> Download MP4</a><button className="secondary" onClick={() => void shareReel()}><Share2 size={17} /> Share</button><button className="secondary" onClick={() => void copyPostCaption()}><Copy size={17} /> Copy caption</button><button className="secondary" onClick={() => setScreen("customize")}>Open Finishing Studio</button><button className="secondary" onClick={() => { if (remixJob?.sourceId !== job?.sourceId) setRemixJob(undefined); setScreen("remix"); }}>Open Remix Lab</button><button className="secondary" onClick={() => setScreen("presets")}>Try another preset <RefreshCw size={17} /></button><button className="secondary" disabled={submitting} onClick={() => void restartSession()}>Start a new reel</button></div>{shareMessage && <p className="share-message">{shareMessage}</p>}{job?.id && <><BattleResult key={`battle-${job.id}`} jobId={job.id} /><PremiereConsent key={`premiere-${job.id}`} jobId={job.id} /><RetrievalLink key={job.id} jobId={job.id} /></>}<section className="cover-picker"><span className="control-label">Pick a reel cover</span><p className="privacy">Three frames from your reel, with your title.</p><div>{job?.coverUrls?.map((cover, index) => <button className={selectedCoverUrl === cover ? "cover-choice selected-cover" : "cover-choice"} key={cover} onClick={() => setSelectedCoverUrl(cover)}><img src={cover} alt={`Cover option ${index + 1}`} /><span>Frame {index + 1}</span></button>)}</div>{selectedCoverUrl && <a className="secondary" href={`${selectedCoverUrl}?download=1`} download={`zenith-reel-cover-${preset.id}.jpg`}><Download size={16} /> Download cover</a>}</section>{renders.length > 1 && <section className="previous-renders"><span className="control-label">Earlier versions</span>{renders.filter((render) => render.id !== job?.id).map((render) => <a key={render.id} href={`${render.outputUrl}?download=1`} download={`zenith-reel-${render.presetId || "version"}.mp4`}>Download {PRESETS.find((item) => item.id === render.presetId)?.name || "previous reel"}</a>)}</section>}<details className="crew-details"><summary>How your creative crew made this reel</summary><AgentCrew stage="completed" presetName={PRESETS.find((item) => item.id === job?.presetId)?.name || preset.name} /></details><div className="badges">{achievements.map((achievement) => <span key={achievement.id}><Check size={16} /> {achievement.label}</span>)}</div></section>}
  </main></RegistrationGate>;
}
