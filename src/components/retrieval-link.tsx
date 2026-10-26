"use client";
/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import QRCode from "qrcode";
export function RetrievalLink({ jobId }: { jobId: string }) {
  const [link, setLink] = useState<{ token: string; url: string; qr: string; expiresAt: number }>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/retrieval", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      const url = new URL(data.path, window.location.origin).href;
      setLink({ ...data, url, qr: await QRCode.toDataURL(url, { width: 240, margin: 2 }) });
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  async function revoke() {
    setBusy(true);
    try { const response = await fetch("/api/retrieval", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: link?.token }) }); if (!response.ok) throw new Error("Could not revoke. Please retry."); setLink(undefined); setMessage("Retrieval link revoked."); }
    catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  return <section className="cover-picker retrieval"><span className="control-label">Take your reel with you</span>{link ? <><img width="200" height="200" src={link.qr} alt="QR code for this reel’s temporary retrieval link" /><a className="secondary" href={link.url} target="_blank" rel="noreferrer">Open retrieval page</a><p className="privacy">Expires {new Date(link.expiresAt).toLocaleString()}. Keep this link private. Phone retrieval needs a reachable HTTPS studio address.</p><button className="secondary" disabled={busy} onClick={() => void revoke()}>Revoke link</button></> : <button className="secondary" disabled={busy} onClick={() => void create()}>{busy ? "Creating…" : "Create private QR link"}</button>}{message && <p role="status">{message}</p>}</section>;
}
