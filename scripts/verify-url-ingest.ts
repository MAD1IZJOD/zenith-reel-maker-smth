import "./isolated-data";
import assert from "node:assert/strict";
import { issueSession, sessionCookie } from "../src/lib/server/security";
import { createSessionId, ensureSession } from "../src/lib/storage/session-storage";
import { POST as IMPORT } from "../src/app/api/sources/route";
import { readSource } from "../src/lib/sources/store";

/**
 * Real direct-link ingestion through the production route with the real SSRF guards. Default source: a public-domain
 * LibriVox recording (Sun Tzu, "The Art of War", read by LibriVox volunteers) on archive.org, which redirects to a
 * storage node, so redirect re-validation is exercised too. Pass another authorized URL as the first argument.
 */
export async function importUrl(url: string) {
  const sessionId = createSessionId(); const { token } = await issueSession(sessionId); await ensureSession(sessionId);
  const cookie = `${sessionCookie(sessionId)}=${token}`;
  const started = Date.now();
  const response = await IMPORT(new Request("http://localhost/api/sources", { method: "POST", headers: { Cookie: cookie }, body: JSON.stringify({ sessionId, url, rightsConfirmed: true }) }));
  const body = await response.json();
  assert.equal(response.status, 202, body.error);
  let source = await readSource(sessionId, body.source.id);
  while (source.status === "ingesting") { await new Promise((resolve) => setTimeout(resolve, 500)); source = await readSource(sessionId, body.source.id); }
  return { sessionId, cookie, source, ingestMs: Date.now() - started };
}

async function main() {
  const url = process.argv[2] || "https://archive.org/download/art_of_war_librivox/art_of_war_01-02_sun_tzu_64kb.mp3";
  const { source, ingestMs } = await importUrl(url);
  assert.equal(source.status, "ready", source.error);
  console.log(JSON.stringify({ url, ingestMs, label: source.label, media: source.media }, null, 2));
}
if (process.argv[1]?.includes("verify-url-ingest")) void main().then(() => process.exit(0), (error) => { console.error(error.message || error); process.exit(1); });
