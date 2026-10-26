// Exploratory UX audit of the real running app (not a pass/fail test): walks the creator journey at phone and
// desktop widths with real footage and records screenshots, console/page errors, failed requests, layout overflow,
// controls outside the viewport, tiny text and step timings. Usage: node scripts/ux-audit.mjs http://localhost:3300
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const base = process.argv[2] || "http://localhost:3300";
const out = path.resolve("data", "ux-audit", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(out, { recursive: true });
const widths = (process.env.UX_WIDTHS || "360,375,390,414,1440").split(",").map(Number);
const generateAt = new Set((process.env.UX_GENERATE || "390,1440").split(",").map(Number));
const fixtures = ["tos-walk-portrait.mp4", "tos-closeup-portrait.mp4", "tos-group-portrait.mp4"].map((name) => path.resolve("data", "fixtures", name));
const findings = [];

async function inspect(page, width, step) {
  const layout = await page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    const overflow = document.documentElement.scrollWidth - vw;
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
    const controls = [...document.querySelectorAll("button, a, input, select, [role=tab], [role=radio]")].filter(visible);
    const offscreen = controls.filter((el) => { const r = el.getBoundingClientRect(); return r.right > vw + 1 || r.left < -1; }).map((el) => (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 40));
    const smallTargets = controls.filter((el) => { const r = el.getBoundingClientRect(); return (r.height < 32 || r.width < 32) && el.tagName !== "INPUT"; }).map((el) => `${(el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30)} (${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)})`);
    const tiny = [...document.querySelectorAll("body *")].filter((el) => el.childElementCount === 0 && (el.textContent || "").trim().length > 2 && visible(el) && parseFloat(getComputedStyle(el).fontSize) < 12).map((el) => `${(el.textContent || "").trim().slice(0, 30)} ${getComputedStyle(el).fontSize}`);
    const primary = [...document.querySelectorAll(".primary, .continue")].filter(visible).map((el) => { const r = el.getBoundingClientRect(); return { text: (el.textContent || "").trim().slice(0, 30), top: Math.round(r.top), belowFold: r.top > vh }; });
    return { overflow, offscreen, smallTargets: smallTargets.slice(0, 12), tiny: [...new Set(tiny)].slice(0, 12), primary, scrollHeight: document.documentElement.scrollHeight, viewportHeight: vh };
  });
  await page.screenshot({ path: path.join(out, `${width}-${step}.png`), fullPage: true });
  findings.push({ width, step, ...layout });
}

async function run(width) {
  const browser = await chromium.launch({ channel: existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe") ? "chrome" : undefined });
  const context = await browser.newContext({ viewport: { width, height: width < 800 ? 820 : 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await context.newPage();
  const events = [];
  page.on("console", (message) => { if (["error", "warning"].includes(message.type())) events.push({ type: `console.${message.type()}`, text: message.text().slice(0, 300) }); });
  page.on("pageerror", (error) => events.push({ type: "pageerror", text: String(error).slice(0, 300) }));
  page.on("requestfailed", (request) => events.push({ type: "requestfailed", text: `${request.method()} ${request.url().replace(base, "")} ${request.failure()?.errorText}` }));
  page.on("response", (response) => { if (response.status() >= 400) events.push({ type: `http ${response.status()}`, text: `${response.request().method()} ${response.url().replace(base, "")}` }); });
  const timings = {};
  const time = async (name, task) => { const started = Date.now(); try { await task(); timings[name] = Date.now() - started; } catch (error) { timings[name] = `FAILED: ${String(error.message || error).split("\n")[0].slice(0, 200)}`; throw error; } };
  try {
    await time("landing", async () => { await page.goto(`${base}/`, { waitUntil: "networkidle" }); });
    await inspect(page, width, "01-landing");
    await time("to-presets", async () => { await page.getByRole("button", { name: /Create from clips|Create your reel/ }).first().click(); await page.locator(".preset-grid").waitFor(); });
    await inspect(page, width, "02-presets");
    await time("to-director", async () => { await page.getByRole("button", { name: /Choose this style/ }).first().click(); await page.getByText(/Here’s your three-shot plan|YOUR SHOT PLAN/).first().waitFor(); });
    await inspect(page, width, "03-director");
    await time("to-record", async () => { await page.getByRole("button", { name: /Use this shot plan/ }).click(); await page.locator(".camera-box").waitFor(); });
    await inspect(page, width, "04-record-empty");
    for (const [index, file] of fixtures.entries()) {
      await time(`upload-${index + 1}`, async () => {
        await page.locator(".shot-progress button").nth(index).click();
        await page.locator('input[type=file]:not([capture])').setInputFiles(file);
        await page.locator(".camera-box video[src*='shot-" + (index + 1) + "']").waitFor({ timeout: 60_000 });
      });
    }
    await inspect(page, width, "05-record-filled");
    await time("to-review", async () => { await page.getByRole("button", { name: /Review three shots/ }).click(); await page.getByText(/FOOTAGE REVIEW/).waitFor(); });
    await inspect(page, width, "06-review");
    await time("to-customize", async () => { await page.getByRole("button", { name: /Customize reel/ }).click(); await page.getByText("Make the final cut.").waitFor(); });
    await inspect(page, width, "07-customize");
    if (generateAt.has(width)) {
      await time("generate", async () => {
        await page.getByRole("button", { name: "Generate MP4" }).click();
        await page.waitForTimeout(600); await inspect(page, width, "08-processing");
        await page.getByRole("heading", { name: "Made from your moments." }).waitFor({ timeout: 180_000 });
      });
      await time("playback-ready", async () => { await page.waitForFunction(() => { const video = document.querySelector(".final-video video"); return video && video.readyState >= 2 && video.duration > 3; }, null, { timeout: 30_000 }); });
      await inspect(page, width, "09-preview");
      await time("download", async () => {
        const download = page.waitForEvent("download");
        await page.getByRole("link", { name: /Download MP4/ }).click();
        const file = await download; const target = path.join(out, `${width}-${file.suggestedFilename()}`); await file.saveAs(target);
        timings.downloadName = file.suggestedFilename();
      });
      await time("regenerate", async () => {
        await page.getByRole("button", { name: "Open Finishing Studio" }).click();
        await page.getByRole("tab", { name: "Captions", exact: true }).click();
        await page.getByRole("combobox", { name: "Caption style" }).selectOption("high-energy");
        await page.getByRole("button", { name: "Generate MP4" }).click();
        await page.getByRole("heading", { name: "Made from your moments." }).waitFor({ timeout: 180_000 });
      });
      await inspect(page, width, "10-regenerated");
    }
  } catch (error) { events.push({ type: "journey-stopped", text: String(error.message || error).split("\n")[0].slice(0, 300) }); await page.screenshot({ path: path.join(out, `${width}-zz-stopped.png`), fullPage: true }).catch(() => undefined); }
  await browser.close();
  return { width, timings, events };
}

const runs = [];
for (const width of widths) { const result = await run(width); runs.push(result); console.log(JSON.stringify(result)); }
writeFileSync(path.join(out, "report.json"), JSON.stringify({ base, runs, findings }, null, 2));
console.log(`Report: ${path.join(out, "report.json")}`);
