"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy, Download, Film, Link2, LoaderCircle, RefreshCw, Sparkles, Upload, Wand2 } from "lucide-react";
import type { SourceRecord } from "@/lib/sources/store";
import type { Highlight } from "@/lib/highlights/discover";
import type { ReelView } from "@/lib/podcast/batch";

type PublicHighlight = Omit<Highlight, "features">;
type Discovery = { selected: PublicHighlight[]; pool: PublicHighlight[]; notice?: string; rankedBy: "heuristic" | "qwen"; model?: string; modelLatencyMs: number; fallbackReason?: string };
type Batch = { id: string; reels: ReelView[]; completed: number; style: { visual: string } };
type Draft = { candidateId?: string; start: number; end: number; title: string; hook: string; role: string; transcript: string };
type Screen = "input" | "analysis" | "review" | "style" | "gallery";

const LENGTHS = [["short", "15–30 s"], ["medium", "30–45 s"], ["long", "45–60 s"]] as const;
const TONES = [["general", "General highlights"], ["educational", "Educational"], ["motivational", "Motivational"], ["storytelling", "Storytelling"], ["business", "Business"], ["technology", "Technology"], ["funny", "Funny"], ["controversial", "Debate (respectful)"]] as const;
const VISUALS = [
  { id: "minimal", name: "Minimal Podcast", note: "Calm gradient, large captions and a waveform drawn from the real audio." },
  { id: "cinematic", name: "Cinematic Quote", note: "Editorial serif type over an abstract colour field from your footage." },
  { id: "broll", name: "Contextual B-Roll", note: "Your own b-roll clips under the voice, or spoken keywords as motion graphics." },
  { id: "speaker", name: "Original video", note: "Your footage framed for 9:16. Shows whoever is on camera." },
] as const;
const CAPTIONS = [["clean-creator", "Clean"], ["podcast-pop", "Creator Pop"], ["cinematic", "Cinematic"], ["minimal", "Minimal"]] as const;
const ROLE = { attention: "Most attention-grabbing", takeaway: "Strongest takeaway", story: "Best story moment", highlight: "Strong moment" } as Record<string, string>;
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const STATUS: Record<string, string> = { queued: "Waiting to render", validating: "Preparing", preparing: "Preparing", rendering: "Rendering", finalizing: "Checking the MP4", completed: "Ready", failed: "Needs a retry", expired: "Expired" };

/** Podcast to Reels: one recording becomes three captioned 9:16 reels. Every status shown is a real server state. */
export function PodcastStudio() {
  const [screen, setScreen] = useState<Screen>("input");
  const [sessionId, setSessionId] = useState("");
  const [mode, setMode] = useState<"upload" | "link">("upload");
  const [rights, setRights] = useState(false);
  const [link, setLink] = useState("");
  const [length, setLength] = useState<string>("medium");
  const [tone, setTone] = useState<string>("general");
  const [source, setSource] = useState<SourceRecord>();
  const [uploadProgress, setUploadProgress] = useState<number>();
  const [stage, setStage] = useState("");
  const [message, setMessage] = useState<string>();
  const [discovery, setDiscovery] = useState<Discovery>();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [visual, setVisual] = useState("minimal");
  const [caption, setCaption] = useState("clean-creator");
  const [soundtrack, setSoundtrack] = useState("none");
  const [volume, setVolume] = useState(0.16);
  const [profile, setProfile] = useState("fast");
  const [broll, setBroll] = useState<SourceRecord[]>([]);
  const [batch, setBatch] = useState<Batch>();
  const [activeReel, setActiveReel] = useState(1);
  const [titleEdits, setTitleEdits] = useState<Record<number, string>>({});
  const [copied, setCopied] = useState<number>();
  const fileInput = useRef<HTMLInputElement>(null), captionInput = useRef<HTMLInputElement>(null), brollInput = useRef<HTMLInputElement>(null);
  const preferences = { length, tone };

  const remember = useCallback((values: Record<string, string | undefined>) => {
    const url = new URL(location.href);
    for (const [key, value] of Object.entries(values)) if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    history.replaceState(null, "", url);
  }, []);
  const readSourceRecord = useCallback(async (id: string, session = sessionId) => {
    const response = await fetch(`/api/sources/${id}?sessionId=${session}`);
    if (!response.ok) throw new Error((await response.json()).error || "Source unavailable.");
    return (await response.json()).source as SourceRecord;
  }, [sessionId]);

  const loadBatch = useCallback(async (id: string, session = sessionId) => {
    const response = await fetch(`/api/podcast/batches/${id}?sessionId=${session}`);
    if (!response.ok) throw new Error((await response.json()).error || "These reels are unavailable.");
    const data = (await response.json()).batch as Batch;
    setBatch(data); return data;
  }, [sessionId]);

  // Session start or recovery after refresh: ?session, ?source and ?batch restore the visitor's place.
  useEffect(() => {
    void (async () => {
      const params = new URLSearchParams(location.search);
      const saved = params.get("session");
      if (saved && /^[a-f0-9-]{36}$/i.test(saved) && (await fetch(`/api/sources?sessionId=${saved}`)).ok) {
        setSessionId(saved);
        try {
          const batchId = params.get("batch"), sourceId = params.get("source");
          if (batchId) { await loadBatch(batchId, saved); setScreen("gallery"); return; }
          if (sourceId) { const record = await readSourceRecord(sourceId, saved); setSource(record); if (record.transcript.status === "ready") setStage("highlights"); }
        } catch (error) { setMessage((error as Error).message); }
        return;
      }
      const response = await fetch("/api/sessions", { method: "POST" });
      if (!response.ok) { setMessage("The studio could not start a session. Reload to try again."); return; }
      const { sessionId: id } = await response.json();
      setSessionId(id); remember({ session: id });
    })();
  }, [loadBatch, readSourceRecord, remember]);

  async function waitForSource(id: string): Promise<SourceRecord> {
    for (;;) {
      const record = await readSourceRecord(id);
      setSource(record);
      if (record.status === "failed") throw new Error(record.error || "This recording could not be imported.");
      if (record.status === "ready" && !["queued", "running"].includes(record.transcript.status)) return record;
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }

  async function analyse(record: SourceRecord) {
    let current = record;
    if (current.transcript.status !== "ready") {
      if (!current.media?.hasAudio) throw new Error("This recording has no audio to turn into reels.");
      setStage("transcribing");
      const response = await fetch(`/api/sources/${current.id}/transcript`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, action: "transcribe" }) });
      if (!response.ok) throw new Error((await response.json()).error || "Transcription is unavailable. Import captions instead.");
      current = await waitForSource(current.id);
      if (current.transcript.status !== "ready") throw new Error(current.transcript.error || "Transcription failed.");
    }
    setStage("highlights");
    const response = await fetch(`/api/sources/${current.id}/highlights`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, preferences }), signal: AbortSignal.timeout(180_000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setDiscovery(data);
    setDrafts(data.selected.map((item: PublicHighlight) => ({ candidateId: item.id, start: item.start, end: item.end, title: item.title, hook: item.hook, role: item.role, transcript: item.transcript })));
    setScreen("review");
  }

  async function findMoments(file?: File) {
    if (!rights) { setMessage("Confirm that you own this recording or have permission to make clips from it."); return; }
    setMessage(undefined); setScreen("analysis"); setStage("preparing");
    try {
      let id: string;
      if (file) {
        id = await new Promise<string>((resolve, reject) => {
          const request = new XMLHttpRequest();
          request.open("PUT", `/api/sources/upload?sessionId=${sessionId}&rights=confirmed&name=${encodeURIComponent(file.name.slice(0, 80))}`);
          request.setRequestHeader("Content-Type", file.type || "video/mp4");
          request.upload.onprogress = (event) => { if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100)); };
          request.onload = () => { setUploadProgress(undefined); try { const data = JSON.parse(request.responseText); if (request.status >= 400) reject(new Error(data.error || data.source?.error || "Upload failed.")); else resolve(data.source.id); } catch { reject(new Error("Upload failed.")); } };
          request.onerror = () => { setUploadProgress(undefined); reject(new Error("The connection dropped during upload. Please try again.")); };
          request.send(file);
        });
      } else {
        const response = await fetch("/api/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, url: link, rightsConfirmed: true }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        id = data.source.id;
      }
      remember({ source: id, batch: undefined });
      await analyse(await waitForSource(id));
    } catch (error) { setMessage((error as Error).name === "TimeoutError" ? "Finding highlights took too long. Please try again." : (error as Error).message); setScreen(source?.status === "ready" ? "analysis" : "input"); }
  }

  async function retryAnalysis() { if (!source) return; setMessage(undefined); setScreen("analysis"); try { await analyse(await readSourceRecord(source.id)); } catch (error) { setMessage((error as Error).message); } }

  async function importCaptions(file: File) {
    if (!source) return;
    const response = await fetch(`/api/sources/${source.id}/transcript`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, action: "import", text: await file.text() }) });
    const data = await response.json();
    if (!response.ok) { setMessage(data.error); return; }
    setMessage(undefined); setScreen("analysis");
    try { await analyse(data.source); } catch (error) { setMessage((error as Error).message); }
  }

  function replaceDraft(index: number, candidateId: string) {
    const item = discovery?.pool.find((entry) => entry.id === candidateId);
    if (!item) return;
    setDrafts((current) => current.map((draft, position) => (position === index ? { candidateId: item.id, start: item.start, end: item.end, title: item.title, hook: item.hook, role: item.role, transcript: item.transcript } : draft)));
  }
  const updateDraft = (index: number, change: Partial<Draft>) => setDrafts((current) => current.map((draft, position) => (position === index ? { ...draft, ...change } : draft)));

  function uploadBroll(file: File) {
    const request = new XMLHttpRequest();
    request.open("PUT", `/api/sources/upload?sessionId=${sessionId}&rights=confirmed&name=${encodeURIComponent(`b-roll ${file.name}`.slice(0, 80))}`);
    request.setRequestHeader("Content-Type", file.type || "video/mp4");
    request.onload = () => { try { const data = JSON.parse(request.responseText); if (request.status >= 400 || !data.source?.media?.hasVideo) setMessage(data.error || "B-roll must be a video clip."); else setBroll((current) => [...current, data.source].slice(0, 4)); } catch { setMessage("B-roll upload failed."); } };
    request.send(file);
  }

  async function generate() {
    if (!source) return;
    setMessage(undefined);
    const reels = drafts.map((draft) => {
      const original = discovery?.pool.find((item) => item.id === draft.candidateId);
      const moved = !original || Math.abs(original.start - draft.start) > 0.01 || Math.abs(original.end - draft.end) > 0.01;
      return { candidateId: draft.candidateId, ...(moved ? { start: draft.start, end: draft.end } : {}), title: draft.title, hook: draft.hook };
    });
    const response = await fetch("/api/podcast/batches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, sourceId: source.id, preferences, style: { visual, captionStyle: caption, soundtrack, musicVolume: volume, profile }, reels, brollIds: broll.map((item) => item.id) }) });
    const data = await response.json();
    if (!response.ok) { setMessage(data.error); return; }
    setBatch(data.batch); setScreen("gallery"); setActiveReel(1); remember({ batch: data.batch.id });
  }

  // While any reel is queued or rendering, poll the real job states.
  useEffect(() => {
    if (screen !== "gallery" || !batch || batch.reels.every((reel) => ["completed", "failed", "expired"].includes(reel.status))) return;
    const timer = setTimeout(() => void loadBatch(batch.id).catch((error) => setMessage(error.message)), 1500);
    return () => clearTimeout(timer);
  }, [screen, batch, loadBatch]);

  async function editReel(index: number, body: Record<string, unknown>) {
    if (!batch) return;
    const response = await fetch(`/api/podcast/batches/${batch.id}/reels/${index}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, ...body }) });
    const data = await response.json();
    if (!response.ok) { setMessage(data.error); return; }
    setBatch(data.batch); setMessage(undefined);
  }

  async function copyCaption(reel: ReelView) {
    try { await navigator.clipboard.writeText(reel.postCaption); setCopied(reel.index); setTimeout(() => setCopied(undefined), 2000); }
    catch { setMessage("Copying is blocked in this browser. Select the caption text instead."); }
  }

  const processed = source?.transcript.processedSeconds, total = source?.media?.duration;
  const alternatives = (index: number) => (discovery?.pool || []).filter((item) => !drafts.some((draft, position) => position !== index && draft.candidateId === item.id));
  const audioOnly = source?.media && !source.media.hasVideo;

  return <main className="podcast-studio">
    <section className="page">
      <Link className="back" href="/"><ArrowLeft size={16} /> Zenith Reel</Link>
      <ol className="pod-steps" aria-label="Progress">{(["input", "review", "style", "gallery"] as const).map((step, index) => <li key={step} className={screen === step || (screen === "analysis" && step === "input") ? "current" : ""}>{["Source", "Highlights", "Style", "Reels"][index]}</li>)}</ol>
      {message && <p className="error" role="alert">{message}</p>}

      {screen === "input" && <>
        <p className="eyebrow">PODCAST TO REELS</p>
        <h2>Turn long videos into short reels.</h2>
        <p className="lede">Add one recording. Zenith transcribes it on this computer, finds three strong moments and edits each into a captioned 9:16 reel.</p>
        <div className="settings-section podcast-import">
          <div className="choice-row" role="group" aria-label="Import method">
            <button className={mode === "link" ? "choice active-choice" : "choice"} aria-pressed={mode === "link"} onClick={() => setMode("link")}><Link2 size={15} /> Paste a video link</button>
            <button className={mode === "upload" ? "choice active-choice" : "choice"} aria-pressed={mode === "upload"} onClick={() => setMode("upload")}><Upload size={15} /> Upload a video</button>
          </div>
          {mode === "link" && <><label className="field-label">Link to a video or audio file<input type="url" inputMode="url" placeholder="https://example.org/episode-12.mp4" value={link} onChange={(event) => setLink(event.target.value)} /></label>
            <p className="privacy">Direct links to media files work best. YouTube, Spotify and similar page links are not downloaded; export your own episode and upload it instead.</p></>}
          <div className="pod-preferences">
            <div><span className="control-label">Clip length</span><div className="choice-row" role="radiogroup" aria-label="Clip length">{LENGTHS.map(([value, label]) => <button key={value} role="radio" aria-checked={length === value} className={length === value ? "choice active-choice" : "choice"} onClick={() => setLength(value)}>{label}</button>)}</div></div>
            <label className="field-label">Focus<select value={tone} onChange={(event) => setTone(event.target.value)}>{TONES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>
          <label className="consent"><input type="checkbox" checked={rights} onChange={(event) => setRights(event.target.checked)} />I own this recording or have permission to make clips from it. Public availability alone is not permission.</label>
          <input ref={fileInput} type="file" accept="video/*,audio/*" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void findMoments(file); }} />
          <button className="primary" disabled={!sessionId || !rights || (mode === "link" && !link)} onClick={() => (mode === "upload" ? fileInput.current?.click() : void findMoments())}><Sparkles size={17} /> Find the best moments</button>
          <p className="privacy">MP4, MOV, WebM, MP3, M4A or WAV. Your recording stays private to this session.</p>
        </div>
      </>}

      {screen === "analysis" && <div className="pod-analysis" role="status" aria-live="polite">
        <LoaderCircle className="spin" size={40} />
        <h2>{stage === "preparing" ? "Preparing your video" : stage === "transcribing" ? "Transcribing speech" : "Finding highlights"}</h2>
        <p className="lede">{stage === "preparing" ? (uploadProgress !== undefined ? `Uploading ${uploadProgress}%` : "Checking that the recording plays correctly.") : stage === "transcribing" ? (processed !== undefined && total ? `${clock(processed)} of ${clock(total)} transcribed on this computer.` : "Starting the speech engine on this computer.") : "Reading the transcript for complete, self-contained moments."}</p>
        {source?.status === "ready" && stage === "transcribing" && <p className="privacy">Already have captions? <button className="text-action" onClick={() => captionInput.current?.click()}>Import SRT, VTT or JSON</button></p>}
        {message && source?.status === "ready" && <div className="actions"><button className="secondary" onClick={() => void retryAnalysis()}><RefreshCw size={16} /> Try again</button><button className="secondary" onClick={() => captionInput.current?.click()}>Import captions instead</button></div>}
        <input ref={captionInput} type="file" accept=".srt,.vtt,.json,text/vtt,application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importCaptions(file); }} />
      </div>}

      {screen === "review" && discovery && <>
        <p className="eyebrow">YOUR HIGHLIGHTS</p>
        <h2>{drafts.length === 3 ? "Three moments worth sharing." : "The moments this recording supports."}</h2>
        <p className="privacy">{discovery.rankedBy === "qwen" ? `Ranked by local ${discovery.model} in ${(discovery.modelLatencyMs / 1000).toFixed(0)}s.` : "Ranked by Zenith's editorial rules."} Scores reflect structure, clarity and pacing, not predicted views. Titles and hooks use the speaker&apos;s own words; edit them freely.</p>
        {discovery.notice && <p className="stage-note">{discovery.notice}</p>}
        <div className="highlight-list">{drafts.map((draft, index) => <article key={`${index}-${draft.candidateId}`} className="highlight-card">
          <p className="eyebrow">REEL {index + 1} · {ROLE[draft.role] || ROLE.highlight}</p>
          <label className="field-label">Title<input value={draft.title} maxLength={60} onChange={(event) => updateDraft(index, { title: event.target.value })} /></label>
          <label className="field-label">Opening hook<input value={draft.hook} maxLength={60} onChange={(event) => updateDraft(index, { hook: event.target.value })} /></label>
          {source?.media?.hasVideo ? <video src={`/api/sources/${source.id}/media?sessionId=${sessionId}#t=${draft.start.toFixed(1)},${draft.end.toFixed(1)}`} controls preload="metadata" playsInline /> : <audio src={`/api/sources/${source?.id}/media?sessionId=${sessionId}#t=${draft.start.toFixed(1)},${draft.end.toFixed(1)}`} controls preload="metadata" />}
          <p className="candidate-text">“{draft.transcript.slice(0, 280)}{draft.transcript.length > 280 ? "…" : ""}”</p>
          <details className="pod-adjust"><summary>Adjust or replace</summary>
            <div className="trim-row"><label className="field-label">Start (s)<input type="number" step="0.5" min="0" value={draft.start} onChange={(event) => updateDraft(index, { start: Number(event.target.value) })} /></label><label className="field-label">End (s)<input type="number" step="0.5" min="0" value={draft.end} onChange={(event) => updateDraft(index, { end: Number(event.target.value) })} /></label></div>
            <p className="privacy">Edges move to the nearest pause between words when the reel is made.</p>
            <label className="field-label">Replace with another moment<select value="" onChange={(event) => replaceDraft(index, event.target.value)}><option value="">Choose a moment…</option>{alternatives(index).map((item) => <option key={item.id} value={item.id}>{clock(item.start)}–{clock(item.end)} · {item.title}</option>)}</select></label>
          </details>
          <p className="privacy">{clock(draft.start)}–{clock(draft.end)} · {Math.round(draft.end - draft.start)} s</p>
        </article>)}</div>
        <div className="actions"><button className="primary" disabled={!drafts.length} onClick={() => setScreen("style")}>Choose a style <Wand2 size={16} /></button><button className="secondary" onClick={() => setScreen("input")}>Use another recording</button></div>
      </>}

      {screen === "style" && <>
        <p className="eyebrow">VISUAL STYLE</p>
        <h2>How should your reels look?</h2>
        <div className="style-grid" role="radiogroup" aria-label="Visual style">{VISUALS.map((item) => <button key={item.id} role="radio" aria-checked={visual === item.id} disabled={item.id === "speaker" && Boolean(audioOnly)} className={`style-card ${visual === item.id ? "selected" : ""} style-${item.id}`} onClick={() => setVisual(item.id)}><span className="style-swatch" aria-hidden="true" /><b>{item.name}</b><small>{item.id === "speaker" && audioOnly ? "Needs a video recording." : item.note}</small></button>)}</div>
        {visual === "broll" && <div className="settings-section broll-panel"><p className="privacy">Add up to four of your own clips (landscape or vertical). Without b-roll, spoken keywords drift behind the captions as motion graphics. Only use footage you are allowed to use.</p>
          <input ref={brollInput} type="file" accept="video/*" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) uploadBroll(file); }} />
          <div className="actions"><button className="secondary" disabled={broll.length >= 4} onClick={() => brollInput.current?.click()}><Film size={16} /> Add b-roll clip</button>{broll.map((item) => <span className="broll-chip" key={item.id}><Check size={14} /> {item.label.replace(/^b-roll /, "")}</span>)}</div></div>}
        <div className="pod-options">
          <div><span className="control-label">Captions</span><div className="choice-row" role="radiogroup" aria-label="Caption style">{CAPTIONS.map(([value, label]) => <button key={value} role="radio" aria-checked={caption === value} className={caption === value ? "choice active-choice" : "choice"} onClick={() => setCaption(value)}>{label}</button>)}</div></div>
          <label className="field-label">Soundtrack<select value={soundtrack} onChange={(event) => setSoundtrack(event.target.value)}><option value="none">Voice only</option><option value="pulse">Neon Steps (original)</option><option value="drift">After Hours (original)</option></select></label>
          {soundtrack !== "none" && <label className="field-label">Music level · ducks under speech<input type="range" min="0.05" max="0.4" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /></label>}
          <div><span className="control-label">Quality</span><div className="choice-row" role="radiogroup" aria-label="Export quality">{[["fast", "Fast · 720p"], ["quality", "Quality · 1080p"]].map(([value, label]) => <button key={value} role="radio" aria-checked={profile === value} className={profile === value ? "choice active-choice" : "choice"} onClick={() => setProfile(value)}>{label}</button>)}</div></div>
        </div>
        <div className="actions"><button className="primary" onClick={() => void generate()}><Sparkles size={17} /> Generate {drafts.length === 1 ? "1 reel" : `${drafts.length} reels`}</button><button className="secondary" onClick={() => setScreen("review")}>Back to highlights</button></div>
      </>}

      {screen === "gallery" && batch && <>
        <p className="eyebrow">YOUR REELS</p>
        <h2>{batch.completed === batch.reels.length ? "Ready to post." : `${batch.completed} of ${batch.reels.length} ready`}</h2>
        <div className="reel-tabs" role="tablist" aria-label="Reels">{batch.reels.map((reel) => <button key={reel.index} role="tab" aria-selected={activeReel === reel.index} onClick={() => setActiveReel(reel.index)}>Reel {reel.index}<small>{STATUS[reel.status]}</small></button>)}</div>
        <div className="reel-gallery">{batch.reels.map((reel) => <article key={reel.index} className={`reel-card ${activeReel === reel.index ? "active" : ""}`} aria-label={`Reel ${reel.index}`}>
          <div className="reel-frame">{reel.status === "completed" && reel.previewUrl ? <video key={reel.previewUrl} src={reel.previewUrl} poster={reel.coverUrl} controls playsInline preload="metadata" /> : <div className="reel-pending" role="status">{reel.status === "failed" || reel.status === "expired" ? <span>{reel.error}</span> : <><LoaderCircle className="spin" size={28} /><span>{STATUS[reel.status]}</span></>}</div>}</div>
          <p className="eyebrow">REEL {reel.index} · {STATUS[reel.status]}{reel.duration ? ` · ${reel.duration.toFixed(0)} s` : ""}</p>
          <h3>{reel.title}</h3>
          <p className="privacy">From {clock(reel.start)}–{clock(reel.end)} of the recording.</p>
          <div className="actions">
            {reel.status === "completed" && reel.downloadUrl && <a className="primary" href={reel.downloadUrl} download={`zenith-reel-0${reel.index}.mp4`}><Download size={16} /> Download</a>}
            <button className="secondary" onClick={() => void copyCaption(reel)}><Copy size={15} /> {copied === reel.index ? "Copied" : "Copy caption"}</button>
            <button className="secondary" disabled={!["completed", "failed", "expired"].includes(reel.status)} onClick={() => void editReel(reel.index, {})}><RefreshCw size={15} /> {reel.status === "failed" ? "Retry" : "Regenerate"}</button>
          </div>
          <details className="pod-adjust"><summary>Edit title</summary><label className="field-label">Title<input value={titleEdits[reel.index] ?? reel.title} maxLength={60} onChange={(event) => setTitleEdits((current) => ({ ...current, [reel.index]: event.target.value }))} /></label><button className="secondary" disabled={!["completed", "failed"].includes(reel.status)} onClick={() => void editReel(reel.index, { changes: { title: titleEdits[reel.index] ?? reel.title } })}>Apply and re-render this reel</button></details>
        </article>)}</div>
        <div className="actions gallery-actions">
          {batch.completed > 0 && <a className="primary" href={`/api/podcast/batches/${batch.id}/zip?sessionId=${sessionId}`}><Download size={17} /> {batch.completed === batch.reels.length ? "Download all" : `Download ${batch.completed} ready`} (ZIP)</a>}
          <button className="secondary" onClick={() => { remember({ batch: undefined }); setScreen("review"); }}>Back to highlights</button>
        </div>
        <p className="privacy">Each reel is an excerpt of the original recording. Post captions say so. Your reels stay private until you share the files yourself.</p>
      </>}
    </section>
  </main>;
}
