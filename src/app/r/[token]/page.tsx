"use client";
import { useEffect, useState, use } from "react";
export default function RetrievalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [reel, setReel] = useState<{ title: string; mediaUrl: string; expiresAt: number }>();
  const [error, setError] = useState("");
  useEffect(() => {
    fetch(`/api/retrieval/${encodeURIComponent(token)}`).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setReel(data); }).catch((error) => setError(error.message));
  }, [token]);
  return <main><section className="preview-page"><p className="eyebrow">SQUAD REEL STUDIO · YOUR REEL</p><h2>{reel?.title || "Your festival moment"}</h2>{error ? <p role="alert" className="error">{error}</p> : reel ? <><div className="final-video"><video src={reel.mediaUrl} controls playsInline /></div><a className="primary" href={`${reel.mediaUrl}&download=1`}>Download MP4</a><p className="privacy">Private retrieval link. Anyone you share it with can watch this reel until {new Date(reel.expiresAt).toLocaleString()}. Original clips and editing access are never included.</p></> : <p role="status">Checking your link…</p>}<p><a className="secondary" href="/festival">Make your own reel</a></p></section></main>;
}
