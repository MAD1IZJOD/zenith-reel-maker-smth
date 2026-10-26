"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileAudio, Link2, LoaderCircle, Mic, Sparkles, Trash2, Upload } from "lucide-react";
import type { SourceRecord } from "@/lib/sources/store";
import type { Transcript } from "@/lib/transcription/schema";
import type { HighlightCandidate } from "@/lib/highlights/candidates";

type Candidates = { windows: number; candidates: HighlightCandidate[]; rankedBy: "qwen" | "heuristic"; model?: string; latencyMs: number; fallbackReason?: string };
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const busy = (source?: SourceRecord) => Boolean(source && (source.status === "ingesting" || ["queued", "running"].includes(source.transcript.status)));

/** Stage 1 of video/podcast-to-reels: import, transcribe and choose highlights. Reel generation is Stage 2. */
export function PodcastStudio() {
  const [sessionId, setSessionId] = useState("");
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [selected, setSelected] = useState<string>();
  const [mode, setMode] = useState<"upload" | "link">("upload");
  const [rights, setRights] = useState(false);
  const [link, setLink] = useState("");
  const [progress, setProgress] = useState<number>();
  const [message, setMessage] = useState<string>();
  const [transcript, setTranscript] = useState<Transcript>();
  const [candidates, setCandidates] = useState<Candidates>();
  const [finding, setFinding] = useState(false);
  const [limits, setLimits] = useState({ maxMegabytes: 1024, maxMinutes: 90 });
  const fileInput = useRef<HTMLInputElement>(null), captionInput = useRef<HTMLInputElement>(null);
  const source = sources.find((item) => item.id === selected);

  const refresh = useCallback(async (id = sessionId) => {
    if (!id) return;
    const response = await fetch(`/api/sources?sessionId=${id}`);
    if (!response.ok) return;
    const data = await response.json() as { sources: SourceRecord[]; limits: typeof limits };
    setSources(data.sources); setLimits(data.limits);
    setSelected((current) => current && data.sources.some((item) => item.id === current) ? current : data.sources.find((item) => item.status === "ready")?.id);
  }, [sessionId]);

  useEffect(() => {
    void (async () => {
      const saved = new URLSearchParams(location.search).get("session");
      if (saved && /^[a-f0-9-]{36}$/i.test(saved) && (await fetch(`/api/sources?sessionId=${saved}`)).ok) { setSessionId(saved); void refresh(saved); return; }
      const response = await fetch("/api/sessions", { method: "POST" });
      if (!response.ok) { setMessage("The studio could not start a session. Reload to try again."); return; }
      const { sessionId: id } = await response.json();
      setSessionId(id);
      const url = new URL(location.href); url.searchParams.set("session", id); history.replaceState(null, "", url);
    })();
  }, [refresh]);

  // Poll only while something is actually processing on the server.
  useEffect(() => { if (!sources.some(busy)) return; const timer = setTimeout(() => void refresh(), 1500); return () => clearTimeout(timer); }, [sources, refresh]);
  useEffect(() => {
    setTranscript(undefined); setCandidates(undefined);
    if (!source || source.transcript.status !== "ready") return;
    void fetch(`/api/sources/${source.id}/transcript?sessionId=${sessionId}`).then(async (response) => { if (response.ok) setTranscript((await response.json()).transcript); });
  }, [source?.id, source?.transcript.status, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  function upload(file: File) {
    if (!rights) { setMessage("Confirm that you own this media or have permission to make clips from it."); return; }
    if (file.size > limits.maxMegabytes * 1048576) { setMessage(`Files can be up to ${limits.maxMegabytes} MB.`); return; }
    setMessage(undefined); setProgress(0);
    const request = new XMLHttpRequest();
    request.open("PUT", `/api/sources/upload?sessionId=${sessionId}&rights=confirmed&name=${encodeURIComponent(file.name.slice(0, 80))}`);
    request.setRequestHeader("Content-Type", file.type || "video/mp4");
    request.upload.onprogress = (event) => { if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100)); };
    request.onload = () => { setProgress(undefined); try { const data = JSON.parse(request.responseText); if (request.status >= 400) setMessage(data.error || data.source?.error || "Upload failed."); else setSelected(data.source.id); } catch { setMessage("Upload failed."); } void refresh(); };
    request.onerror = () => { setProgress(undefined); setMessage("The connection dropped during upload. Please try again."); };
    request.send(file);
  }

  async function importLink() {
    setMessage(undefined);
    const response = await fetch("/api/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, url: link, rightsConfirmed: rights }) });
    const data = await response.json();
    if (!response.ok) { setMessage(data.error); return; }
    setLink(""); setSelected(data.source.id); void refresh();
  }

  async function transcriptAction(body: Record<string, unknown>) {
    if (!source) return;
    setMessage(undefined);
    const response = await fetch(`/api/sources/${source.id}/transcript`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, ...body }) });
    const data = await response.json();
    if (!response.ok) setMessage(data.error);
    void refresh();
  }

  async function findHighlights(rank: boolean) {
    if (!source) return;
    setFinding(true); setMessage(undefined);
    try {
      const response = await fetch(`/api/sources/${source.id}/candidates?sessionId=${sessionId}${rank ? "&rank=model" : ""}`, { signal: AbortSignal.timeout(90_000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setCandidates(data);
    } catch (error) { setMessage((error as Error).name === "TimeoutError" ? "Ranking took too long; showing nothing new. Try the heuristic list." : (error as Error).message); }
    finally { setFinding(false); }
  }

  async function remove(id: string) {
    const response = await fetch(`/api/sources/${id}?sessionId=${sessionId}`, { method: "DELETE" });
    if (!response.ok) setMessage((await response.json()).error);
    void refresh();
  }

  return <main className="podcast-studio">
    <section className="page">
      <Link className="back" href="/"><ArrowLeft size={16} /> Zenith Reel</Link>
      <p className="eyebrow">CREATE FROM VIDEO / PODCAST · STAGE 1</p>
      <h2>Find the moments worth sharing.</h2>
      <p className="lede">Import a recording, transcribe it on this computer, and review sentence-aligned highlight candidates. Turning three highlights into finished reels arrives in the next release.</p>
      {message && <p className="error" role="alert">{message}</p>}

      <div className="settings-section podcast-import">
        <div className="choice-row" role="group" aria-label="Import method">
          <button className={mode === "upload" ? "choice active-choice" : "choice"} aria-pressed={mode === "upload"} onClick={() => setMode("upload")}><Upload size={15} /> Upload a file</button>
          <button className={mode === "link" ? "choice active-choice" : "choice"} aria-pressed={mode === "link"} onClick={() => setMode("link")}><Link2 size={15} /> Direct media link</button>
        </div>
        <label className="consent"><input type="checkbox" checked={rights} onChange={(event) => setRights(event.target.checked)} />I own this recording or have permission to make clips from it. Public availability alone is not permission.</label>
        {mode === "upload" ? <>
          <input ref={fileInput} type="file" accept="video/*,audio/*" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) upload(file); }} />
          <button className="primary" disabled={!sessionId || progress !== undefined || !rights} onClick={() => fileInput.current?.click()}><Upload size={17} /> {progress !== undefined ? `Uploading ${progress}%` : "Choose video or audio"}</button>
          <p className="privacy">MP4, MOV, WebM, MP3, M4A or WAV · up to {limits.maxMegabytes} MB and {limits.maxMinutes} minutes. Stays private to this session.</p>
        </> : <>
          <label className="field-label">Link to a media file<input type="url" inputMode="url" placeholder="https://example.org/episode-12.mp4" value={link} onChange={(event) => setLink(event.target.value)} /></label>
          <button className="primary" disabled={!sessionId || !link || !rights} onClick={() => void importLink()}><Link2 size={17} /> Import from link</button>
          <p className="privacy">Use a direct link to the file itself. YouTube, Spotify, Instagram and similar page links are not downloaded; export your own episode from your creator tools and upload it.</p>
        </>}
      </div>

      {sources.length > 0 && <div className="podcast-sources" aria-label="Your sources">{sources.map((item) => <article key={item.id} className={`settings-section source-card ${item.id === selected ? "selected" : ""}`}>
        <button className="source-select" onClick={() => setSelected(item.id)} aria-pressed={item.id === selected}><FileAudio size={18} /><span><b>{item.label}</b><small>{item.status === "ready" && item.media ? `${clock(item.media.duration)} · ${item.media.hasVideo ? `${item.media.width} × ${item.media.height} video` : "audio only"}${item.media.hasAudio ? "" : " · no audio"}` : item.status === "ingesting" ? "Importing and checking…" : item.error}</small></span></button>
        <button className="icon-control" aria-label={`Remove ${item.label}`} disabled={busy(item)} onClick={() => void remove(item.id)}><Trash2 size={16} /></button>
      </article>)}</div>}

      {source?.status === "ready" && <section className="settings-section podcast-transcript">
        <p className="eyebrow">TRANSCRIPT</p>
        {source.transcript.status === "ready" ? <p className="privacy" role="status"><b>{source.transcript.engine === "faster-whisper" ? `Transcribed locally with Whisper ${source.transcript.model}` : "Imported transcript"}</b> · {source.transcript.segments} segments · {source.transcript.wordTimestamps ? `${source.transcript.words} words with measured timing` : "segment timing only (no word highlighting)"}{source.transcript.processingMs ? ` · ${(source.transcript.processingMs / 1000).toFixed(1)}s` : ""}</p>
          : ["queued", "running"].includes(source.transcript.status) ? <p className="privacy" role="status"><LoaderCircle className="spin" size={15} /> {source.transcript.status === "queued" ? "Waiting for the transcription engine…" : "Transcribing on this computer. Long recordings take a few minutes."}</p>
            : <p className="privacy">{source.transcript.status === "failed" ? source.transcript.error : "Speech becomes searchable text with word timing. Nothing leaves this computer."}</p>}
        <div className="actions">
          <button className="primary" disabled={busy(source) || !source.media?.hasAudio} onClick={() => void transcriptAction({ action: "transcribe" })}><Mic size={17} /> {source.transcript.status === "ready" ? "Transcribe again" : "Transcribe locally"}</button>
          <input ref={captionInput} type="file" accept=".srt,.vtt,.json,text/vtt,application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void file.text().then((text) => transcriptAction({ action: "import", text })); }} />
          <button className="secondary" disabled={busy(source)} onClick={() => captionInput.current?.click()}>Import captions (SRT, VTT, JSON)</button>
        </div>
        {transcript && <ol className="transcript-preview">{transcript.segments.slice(0, 40).map((segment, index) => <li key={index}><time>{clock(segment.start)}</time>{segment.text}</li>)}{transcript.segments.length > 40 && <li className="privacy">…{transcript.segments.length - 40} more segments</li>}</ol>}
      </section>}

      {source?.transcript.status === "ready" && <section className="settings-section podcast-highlights">
        <p className="eyebrow">HIGHLIGHT CANDIDATES</p>
        <div className="actions">
          <button className="primary" disabled={finding} onClick={() => void findHighlights(false)}><Sparkles size={17} /> {finding ? "Finding…" : "Find highlights"}</button>
          <button className="secondary" disabled={finding} onClick={() => void findHighlights(true)}>Rank with local AI</button>
        </div>
        {candidates && <p className="privacy" role="status">{candidates.windows} sentence-aligned windows considered · {candidates.rankedBy === "qwen" ? `ranked by local ${candidates.model} in ${(candidates.latencyMs / 1000).toFixed(1)}s` : "ranked by a transparent heuristic"}{candidates.fallbackReason ? ` (${candidates.fallbackReason})` : ""}. Scores describe structure and pacing, not predicted views.</p>}
        <div className="candidate-grid">{candidates?.candidates.map((candidate, index) => <article key={candidate.id} className="candidate-card">
          <p className="eyebrow">MOMENT {index + 1} · {clock(candidate.start)}–{clock(candidate.end)} · {candidate.duration.toFixed(0)}s</p>
          <h3>{candidate.hook}</h3>
          {source.media?.hasVideo ? <video src={`/api/sources/${source.id}/media?sessionId=${sessionId}#t=${candidate.start.toFixed(1)},${candidate.end.toFixed(1)}`} controls preload="metadata" playsInline /> : <audio src={`/api/sources/${source.id}/media?sessionId=${sessionId}#t=${candidate.start.toFixed(1)},${candidate.end.toFixed(1)}`} controls preload="metadata" />}
          <p className="candidate-text">{candidate.transcript}</p>
          <p className="privacy">Topic: {candidate.topic} · completeness {Math.round(candidate.completeness * 100)}% · heuristic score {Math.round(candidate.estimatedEngagement * 100)}</p>
          <p className="privacy">{candidate.rationale}</p>
        </article>)}</div>
        {candidates && <p className="stage-note">Next release: generate these as three captioned 9:16 reels. Today, they are a reviewed shortlist with exact source times.</p>}
      </section>}
    </section>
  </main>;
}
