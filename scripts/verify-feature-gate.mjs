// Starts the real production server with a given environment and checks what visitors and API clients can reach.
// Usage: node scripts/verify-feature-gate.mjs   (after npm run build). Uses an isolated data directory and port 3311.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const port = 3311, base = `http://127.0.0.1:${port}`;
const scenarios = [
  { name: "festival switch PODCAST_MODE=off", env: { PODCAST_MODE: "off" }, expectEnabled: false },
  { name: "host without transcription (auto)", env: { TRANSCRIBE_PYTHON: path.join(os.tmpdir(), "zenith-no-python", "python") }, expectEnabled: false },
  { name: "host with transcription (auto)", env: {}, expectEnabled: true },
];

async function waitReady() {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`${base}/api/ready`)).ok) return; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }
  throw new Error("server did not start");
}

const browser = await chromium.launch({ channel: existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe") ? "chrome" : undefined });
// The studio renders on the client, so pages are checked in a real browser at phone size.
async function pageText(url) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(url, { waitUntil: "networkidle" });
  if (await page.getByLabel("Your name", { exact: true }).isVisible()) {
    await page.getByLabel("Your name", { exact: true }).fill("Feature Test");
    await page.getByLabel("Email address", { exact: true }).fill("feature-test@example.com");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Continue to the studio" }).click();
    await page.getByLabel("Your name", { exact: true }).waitFor({ state: "hidden" });
  }
  const html = await page.content(); await page.close(); return html;
}
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };
for (const scenario of scenarios) {
  const data = mkdtempSync(path.join(os.tmpdir(), "zenith-gate-"));
  const env = { ...process.env, NODE_ENV: "production", PORT: String(port), HOSTNAME: "127.0.0.1", COOKIE_SECURE: "false", PUBLIC_BASE_URL: base, DATA_DIR: data, CREATIVE_MODEL_PROVIDER: "off", ...scenario.env };
  if (!("PODCAST_MODE" in scenario.env)) delete env.PODCAST_MODE;
  const server = spawn(process.execPath, ["scripts/serve.mjs"], { env, stdio: "ignore", windowsHide: true });
  try {
    await waitReady();
    console.log(`\n${scenario.name}`);
    const home = await pageText(`${base}/`);
    const festival = await pageText(`${base}/festival`);
    const podcast = await pageText(`${base}/podcast`);
    check(home.includes("Create from clips"), "landing offers Create from clips");
    check(scenario.expectEnabled ? home.includes('href="/podcast"') : !home.includes('href="/podcast"') && home.includes("Unavailable here today"), `landing podcast entry ${scenario.expectEnabled ? "is a link" : "is labelled unavailable and not a link"}`);
    check(festival.includes("Start Creating"), "festival page renders");
    check(scenario.expectEnabled ? !podcast.includes("PODCAST TO REELS · UNAVAILABLE") : podcast.includes("PODCAST TO REELS · UNAVAILABLE"), `/podcast ${scenario.expectEnabled ? "opens the studio" : "explains it is unavailable"}`);
    const session = await fetch(`${base}/api/sessions`, { method: "POST", headers: { Origin: base } });
    const { sessionId } = await session.json();
    const cookie = (session.headers.get("set-cookie") || "").split(";")[0];
    const sources = await fetch(`${base}/api/sources?sessionId=${sessionId}`, { headers: { cookie } });
    check(scenario.expectEnabled ? sources.status === 200 : sources.status === 404, `GET /api/sources -> ${sources.status}`);
    const upload = await fetch(`${base}/api/sources/upload?sessionId=${sessionId}&rights=confirmed&name=x`, { method: "PUT", headers: { cookie, Origin: base, "Content-Type": "audio/wav" }, body: new Uint8Array(1024) });
    check(scenario.expectEnabled ? upload.status !== 404 : upload.status === 404, `PUT /api/sources/upload -> ${upload.status}`);
    const batch = await fetch(`${base}/api/podcast/batches`, { method: "POST", headers: { cookie, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) });
    check(scenario.expectEnabled ? batch.status !== 404 : batch.status === 404, `POST /api/podcast/batches -> ${batch.status}`);
    check(session.status === 200 && !!sessionId, `clip session creation still works -> ${session.status}`);
  } finally { server.kill(); await new Promise((r) => setTimeout(r, 800)); rmSync(data, { recursive: true, force: true }); }
}
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll feature gate checks passed");
process.exitCode = failures ? 1 : 0;
