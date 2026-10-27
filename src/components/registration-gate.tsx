"use client";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

export function RegistrationGate({ sessionId, children }: { sessionId: string; children: ReactNode }) {
  const [status, setStatus] = useState<"loading" | "form" | "ready" | "error">("loading");
  const [days, setDays] = useState(30);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    void fetch(`/api/sessions/${sessionId}/registration`, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Could not check your registration. Please retry.");
      const result = await response.json();
      setDays(result.retentionDays); setStatus(result.registered ? "ready" : "form"); setError("");
    }).catch((problem) => { if (!controller.signal.aborted) { setError(problem.message); setStatus("error"); } });
    return () => controller.abort();
  }, [sessionId, retry]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (saving) return;
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/sessions/${sessionId}/registration`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, acknowledged }), signal: AbortSignal.timeout(15_000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save your details.");
      setName(""); setEmail(""); setStatus("ready");
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Connection lost. Please retry."); }
    finally { setSaving(false); }
  }
  if (status === "ready") return children;
  return <main><header><span className="brand"><span className="brand-mark">Z</span> ZENITH REEL</span></header><section className="page registration-page">
    <p className="eyebrow">BEFORE YOUR FIRST FRAME</p><h1>Let’s meet the creator.</h1>
    <p className="lede">Enter your name and email to start making reels. No password needed.</p>
    {status === "loading" && <p role="status">Checking your session…</p>}
    {status === "error" && <><p className="error" role="alert">{error}</p><button className="primary" onClick={() => { setStatus("loading"); setRetry((value) => value + 1); }}>Retry registration</button></>}
    {status === "form" && <form className="settings-section" onSubmit={(event) => void submit(event)}>
      <label className="field-label">Your name<input name="name" autoComplete="name" required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="field-label">Email address<input name="email" type="email" autoComplete="email" inputMode="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <p className="privacy" id="registration-notice">The studio organizer collects your name and email with this reel session and can export them privately as a CSV. They are kept for {days} days and are not shown on public reels or QR pages. This does not sign you up for marketing or send an email. <a href="/privacy" target="_blank" rel="noreferrer">Privacy details</a>.</p>
      <label className="registration-consent"><input type="checkbox" required checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} aria-describedby="registration-notice" /><span>I understand that my name and email will be saved by the organizer.</span></label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={saving}>{saving ? "Saving your details…" : "Continue to the studio"}</button>
    </form>}
  </section></main>;
}
