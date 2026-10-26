"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { PRESETS } from "@/lib/presets";
import { CHALLENGES } from "@/lib/creative/challenges";
type DisplayData = { settings: { paused: boolean; demoOnly: boolean }; playlist: { id: string; mediaUrl: string }[]; entries: { rank: number; nickname: string; score: number; challenge: string }[]; leaderboardEnabled: boolean };
export default function DisplayScreen({ publicBaseUrl }: { publicBaseUrl: string }) {
  const [data, setData] = useState<DisplayData>(); const [index, setIndex] = useState(0); const [qr, setQr] = useState(""); const [url, setUrl] = useState("");
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const entry = new URL("/festival", publicBaseUrl || window.location.origin).href; setUrl(entry);
    void QRCode.toDataURL(entry, { width: 220, margin: 2 }).then(setQr);
    const update = async () => { try { const response = await fetch("/api/display", { cache: "no-store" }); if (!response.ok) throw new Error(); setData(await response.json()); setOffline(false); } catch { setOffline(true); setData(undefined); } };
    void update(); const timer = setInterval(() => void update(), 5000); return () => clearInterval(timer);
  }, [publicBaseUrl]);
  const playlist = data?.playlist || []; const entry = playlist.length ? playlist[index % playlist.length] : undefined;
  const preset = PRESETS[index % PRESETS.length]; const challenge = CHALLENGES[index % CHALLENGES.length];
  return <main className="stall-screen"><section className="stall-intro"><p className="eyebrow">ZENITH IDEAS 4.0 · ZENITH AGENTIC REEL MAKER</p><h1>3 Shots.<br /><span>1 Epic Reel.</span></h1><p className="lede">Pick a style. Capture three moments. Take home your reel.</p><div className="display-qr">{qr && <img src={qr} width="180" height="180" alt="Scan to open the public festival creator page" />}<div><h3>Scan. Create. Replay.</h3><p className="privacy">{url}</p><p className="privacy">No login. Camera or uploads. Demo available.</p></div></div><div className="stall-challenge"><p className="eyebrow">TRY A REEL BATTLE</p><h3>{challenge.title}</h3><p>{challenge.description}</p></div>{data?.leaderboardEnabled && <div className="stall-leaderboard"><h3>Today’s squad standings</h3>{data.entries.length ? data.entries.slice(0, 5).map((entry) => <p key={entry.rank}><b>{entry.rank}. {entry.nickname}</b><span>{entry.score} pts</span></p>) : <p>Be the first to complete a challenge.</p>}<small>Completion points, not a video quality rating.</small></div>}</section><section className="stall-reel"><p className="eyebrow">{data?.settings.paused ? "SCREENINGS PAUSED" : entry ? "PARTICIPANT PREMIERE · APPROVED" : `SAMPLE DEMONSTRATION · ${preset.name}`}</p>{data?.settings.paused ? <div className="display-paused"><h2>Your next story starts here.</h2><p>Scan the code to create.</p></div> : <video key={entry?.id || preset.id} src={entry?.mediaUrl || `/previews/${preset.id}.mp4`} autoPlay muted playsInline controls onEnded={() => setIndex((value) => value + 1)} onError={(event) => { if (!entry && !event.currentTarget.src.includes("/samples/")) event.currentTarget.src = "/samples/shot-1.mp4"; else setIndex((value) => value + 1); }} />}{offline && <p className="privacy">Live updates paused. Showing local sample footage.</p>}<p className="privacy">Only explicitly consented, staff-approved reels can appear here.</p></section></main>;
}
