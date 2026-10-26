"use client";
import { useEffect, useState } from "react";
export function PremiereConsent({ jobId }: { jobId: string }) {
  const [entry, setEntry] = useState<{ id: string; status: string }>();
  const [basis, setBasis] = useState(""); const [permission, setPermission] = useState(false); const [promo, setPromo] = useState(false);
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { fetch(`/api/premiere?jobId=${jobId}`).then(async (response) => { if (response.ok) setEntry((await response.json()).entry || undefined); }).catch(() => setMessage("Screening status is unavailable. Try again shortly.")); }, [jobId]);
  async function act(revoke = false) {
    setBusy(true);
    try {
      const response = await fetch("/api/premiere", { method: revoke ? "DELETE" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(revoke ? { id: entry?.id } : { jobId, consentBasis: basis, allPeopleAgree: permission, promoReuse: promo }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (revoke) { setEntry(undefined); setPermission(false); setPromo(false); setMessage("Permission revoked. Future public playback is blocked. This cannot undo a screening that already happened."); }
      else { setEntry(data.entry); setMessage("Submitted privately for staff review. It will only appear after approval."); }
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  return <section className="cover-picker"><span className="control-label">Optional festival premiere</span><p className="privacy">Your reel stays private by default. Staff must approve every screening. Public screening and promotional reuse are separate choices.</p>{entry && entry.status !== "revoked" ? <><p>Status: {entry.status}</p><button className="secondary" disabled={busy} onClick={() => void act(true)}>Revoke screening and reuse permission</button></> : <><label className="field-label">Permission for everyone shown<select value={basis} onChange={(event) => setBasis(event.target.value)}><option value="">Choose only if confirmed</option><option value="adult">Everyone is 18+ and has agreed</option><option value="guardian">Parent or guardian has agreed for each person under 18</option></select></label><label className="consent"><input type="checkbox" checked={permission} onChange={(event) => setPermission(event.target.checked)} /><span>Everyone shown agrees to this reel playing on the festival screen.</span></label><label className="consent"><input type="checkbox" checked={promo} onChange={(event) => setPromo(event.target.checked)} /><span>Separately, allow the festival team to reuse this reel for promotion.</span></label><button className="secondary" disabled={busy || !permission || !basis} onClick={() => void act()}>Request a public premiere</button></>}{message && <p className="privacy" role="status">{message}</p>}<a className="privacy" href="/privacy">Storage, permissions and privacy</a></section>;
}
