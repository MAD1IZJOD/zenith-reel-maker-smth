"use client";
import { useEffect, useState } from "react";
type Result = { challenge: string; score: number; criteria: { label: string; points: number; met: boolean }[]; note: string };
export function BattleResult({ jobId }: { jobId: string }) {
  const [data, setData] = useState<{ result?: Result; enabled: boolean; nicknames: string[] }>();
  const [nickname, setNickname] = useState("Calm Comets"); const [optIn, setOptIn] = useState(false); const [message, setMessage] = useState("");
  useEffect(() => { fetch(`/api/battle?jobId=${jobId}`).then(async (response) => { if (response.ok) setData(await response.json()); }).catch(() => setMessage("Challenge result is temporarily unavailable.")); }, [jobId]);
  async function join() {
    try { const response = await fetch("/api/battle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, nickname, optIn }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); setMessage(`Entered as ${result.entry.nickname}. Only your nickname and completion points are public.`); }
    catch (error) { setMessage((error as Error).message); }
  }
  if (!data?.result) return null;
  return <section className="cover-picker"><span className="control-label">Reel Battle · {data.result.challenge}</span><h3>{data.result.score} / 100 completion points</h3><ul>{data.result.criteria.map((item) => <li key={item.label}>{item.met ? "✓" : "—"} {item.label}: {item.met ? item.points : 0} / {item.points}</li>)}</ul><p className="privacy">{data.result.note}</p>{data.enabled && <><label className="field-label">Anonymous squad nickname<select value={nickname} onChange={(event) => setNickname(event.target.value)}>{data.nicknames.map((name) => <option key={name}>{name}</option>)}</select></label><label className="consent"><input type="checkbox" checked={optIn} onChange={(event) => setOptIn(event.target.checked)} /><span>Show my nickname and points on today’s leaderboard. No footage is included.</span></label><button className="secondary" disabled={!optIn} onClick={() => void join()}>Join leaderboard</button></>}{message && <p role="status">{message}</p>}</section>;
}
