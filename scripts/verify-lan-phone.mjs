// Phone emulation over a plain-HTTP LAN address, where browsers refuse in-page camera access. Checks that the record
// screen leads with the phone's own camera app and that uploads work. Not a physical-device test.
// Usage: node scripts/verify-lan-phone.mjs http://<laptop-wifi-ip>:3000   (server started with that PUBLIC_BASE_URL)
import { chromium, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";

const base = process.argv[2];
if (!base || /localhost|127\.0\.0\.1/.test(base)) { console.error("Pass the laptop's LAN address, e.g. http://192.168.1.20:3000"); process.exit(2); }
const browser = await chromium.launch({ channel: existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe") ? "chrome" : undefined });
const context = await browser.newContext({ ...devices["Pixel 7"], defaultBrowserType: undefined });
const page = await context.newPage();
const errors = []; page.on("pageerror", (error) => errors.push(String(error)));
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failures++; };
await page.goto(`${base}/festival`, { waitUntil: "networkidle" });
check(!(await page.evaluate(() => window.isSecureContext)), "plain HTTP LAN address is not a secure context (in-page camera unavailable)");
await page.getByRole("button", { name: "Start Creating" }).tap();
await page.locator(".preset .card-action").first().tap();
await page.getByRole("button", { name: "Use this shot plan" }).tap();
check(await page.getByRole("button", { name: "Open camera", exact: true }).count() === 0, "no Open camera button that could only fail");
check(await page.locator(".camera-actions .primary", { hasText: "Use phone camera" }).count() === 1, "Use phone camera is the primary action");
check(await page.locator("input[type=file][capture]").count() === 1, "native camera capture input present");
await page.locator("input[type=file]:not([capture])").setInputFiles(path.resolve("public/samples/shot-1.mp4"));
await page.locator(".camera-box video[src*='shot-1']").waitFor({ timeout: 30_000 }).then(() => check(true, "upload over LAN HTTP works"), () => check(false, "upload over LAN HTTP works"));
check(errors.length === 0, `no page errors ${errors.join(" ")}`);
await browser.close();
process.exitCode = failures ? 1 : 0;
