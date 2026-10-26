"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Download, Play, Star } from "lucide-react";
import { PRESETS } from "@/lib/presets";
import { defaultCreativeOptions } from "@/lib/creative/options";
import type { StudioJob } from "@/types/studio";
import { useStudioMotion } from "@/hooks/use-studio-motion";

export function RemixLab({ sessionId, original, candidate, onCandidate, onBack, onFavorite, favoriteId }: {
  sessionId: string; original: StudioJob; candidate?: StudioJob; onCandidate: (job: StudioJob) => void;
  onBack: () => void; onFavorite: (id: string) => void; favoriteId?: string;
}) {
  const [selected, setSelected] = useState(PRESETS.find((preset) => preset.id !== original.presetId)!.id);
  const [view, setView] = useState<"original" | "remix">("original");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const originalPlayer = useRef<HTMLVideoElement>(null), remixPlayer = useRef<HTMLVideoElement>(null);
  const scope = useStudioMotion(candidate?.stage || "empty");
  const pending = Boolean(candidate && !["failed", "completed"].includes(candidate.stage));
  useEffect(() => {
    if (!candidate || !pending) return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const response = await fetch(`/api/jobs?id=${candidate.id}`, { signal: AbortSignal.timeout(15_000) }); if (!response.ok) throw new Error("Could not check this render. Reconnect to continue."); const data = await response.json(); if (!cancelled) { onCandidate(data.job); setError(undefined); } }
      catch (error) { if (!cancelled) setError((error as Error).message); }
      if (!cancelled) timer = setTimeout(() => void poll(), 1500);
    };
    timer = setTimeout(() => void poll(), 500); return () => { cancelled = true; clearTimeout(timer); };
  }, [candidate, pending, onCandidate]);
  async function remix() {
    if (submitting || pending) return;
    setSubmitting(true); setError(undefined);
    try {
      const preset = PRESETS.find((item) => item.id === selected)!;
      const response = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, sourceJobId: original.id, presetId: preset.id, title: preset.title, creative: defaultCreativeOptions(preset) }), signal: AbortSignal.timeout(20_000) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Remix could not start. Your original is saved."); onCandidate(data.job); setView("remix");
    } catch (error) { setError((error as Error).message); } finally { setSubmitting(false); }
  }
  async function playTogether() {
    const players = [originalPlayer.current, remixPlayer.current].filter((video): video is HTMLVideoElement => Boolean(video));
    players.forEach((video) => { video.currentTime = 0; video.muted = true; });
    const results = await Promise.allSettled(players.map((video) => video.play()));
    if (results.some((result) => result.status === "rejected")) setError("Tap each player to start playback in this browser.");
  }
  return <div ref={scope}><section className="page remix-page"><button className="back" onClick={onBack}><ChevronLeft size={16} /> Back to your reel</button><p className="eyebrow" data-reveal>REMIX LAB / TWO PERSPECTIVES</p><h2 data-reveal>Same moments.<br />A different story.</h2><p className="lede">Compare two real edits from the original footage. Your first reel stays yours.</p>
    <div className="remix-toolbar"><label className="field-label">Remix style<select value={selected} disabled={pending || submitting} onChange={(event) => setSelected(event.target.value as typeof selected)}>{PRESETS.filter((preset) => preset.id !== original.presetId).map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label><button className="primary" disabled={pending || submitting} onClick={() => void remix()}>{submitting ? "Submitting…" : pending ? `Remix ${candidate?.stage}…` : "Render second style"}</button>{candidate?.stage === "completed" && <button className="secondary sync-play" onClick={() => void playTogether()}><Play size={16} /> Play both from start</button>}</div>
    {error && <p className="error" role="alert">{error}</p>}<div className="comparison-tabs" role="group" aria-label="Choose comparison preview"><button className={view === "original" ? "choice active-choice" : "choice"} onClick={() => { remixPlayer.current?.pause(); setView("original"); }}>Original edit</button><button className={view === "remix" ? "choice active-choice" : "choice"} onClick={() => { originalPlayer.current?.pause(); setView("remix"); }}>Remix edit</button></div>
    <div className={`comparison-room view-${view}`}>{[{ render: original, label: "Original edit", ref: originalPlayer, slot: "original" }, { render: candidate, label: "Remix edit", ref: remixPlayer, slot: "remix" }].map(({ render, label, ref, slot }) => <article className={`comparison-panel ${slot}`} key={slot}><div className="comparison-heading"><p className="eyebrow">{label}</p><h3>{PRESETS.find((preset) => preset.id === render?.presetId)?.name || "A new direction"}</h3></div>{render?.stage === "completed" && render.outputUrl ? <><video ref={ref} src={render.outputUrl} poster={render.coverUrl} controls muted playsInline preload="metadata" /><p className="privacy">{render.metrics?.outputDurationSeconds?.toFixed(1)} sec · 720 × 1280{render.metrics?.outputBytes ? ` · ${(render.metrics.outputBytes / 1_000_000).toFixed(2)} MB` : ""}</p><div className="actions"><a className="primary" href={`${render.outputUrl}?download=1`}><Download size={16} /> Download {slot}</a><button className="secondary" aria-pressed={favoriteId === render.id} onClick={() => onFavorite(render.id)}><Star size={16} fill={favoriteId === render.id ? "currentColor" : "none"} />{favoriteId === render.id ? "Your favorite" : "Choose favorite"}</button></div></> : <div className="comparison-empty" role="status"><span>{render?.stage === "failed" ? render.error : pending ? `Your remix is ${render?.stage}.` : "Choose another style, then render your second edit."}</span></div>}</article>)}</div><p className="privacy">Native player controls include sound and fullscreen. Side-by-side playback starts both at zero; different edits may end at different times.</p></section></div>;
}
