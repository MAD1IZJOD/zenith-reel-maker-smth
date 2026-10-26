import { test, expect, devices } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Phone EMULATION of the festival journey (touch, mobile user agent, phone viewport and pixel density) with Chromium's
 * synthetic camera. This is regression coverage, not a physical-device result: real iPhone Safari and Android camera
 * hardware must still be checked by hand (deploy/FESTIVAL_LAUNCH.md).
 */
const sample = (shot: number) => path.join(process.cwd(), "public", "samples", `shot-${shot}.mp4`);
const profiles = [
  { name: "Android phone (Pixel 7 profile)", device: devices["Pixel 7"] },
  // Only Chromium is installed here: this uses iPhone dimensions and user agent, not the WebKit engine.
  { name: "iPhone-sized phone (iPhone 14 profile, Chromium engine)", device: { ...devices["iPhone 14"], defaultBrowserType: undefined } },
];

for (const { name, device } of profiles) {
  test.describe(name, () => {
    test.use({ viewport: device.viewport, userAgent: device.userAgent, deviceScaleFactor: device.deviceScaleFactor, isMobile: device.isMobile, hasTouch: device.hasTouch });

    test("camera, flip, retake, upload fallback, refresh, network drop, generate, play and download", async ({ page, context }) => {
      test.setTimeout(240_000);
      const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
      await context.grantPermissions(["camera"]);
      await page.goto("/festival");
      await page.getByRole("button", { name: "Start Creating" }).tap();
      await page.locator(".preset .card-action").first().tap();
      await page.getByRole("button", { name: "Use this shot plan" }).tap();

      // Shot 1: in-page camera recording.
      const live = page.locator(".camera-box video");
      await page.getByRole("button", { name: "Open camera", exact: true }).tap();
      await expect.poll(() => live.evaluate((video: HTMLVideoElement) => Boolean(video.srcObject))).toBe(true);
      // Flip asks for the other facing camera; the synthetic device answers, so the preview must stay live.
      await page.getByRole("button", { name: "Flip" }).tap();
      await expect.poll(() => live.evaluate((video: HTMLVideoElement) => Boolean(video.srcObject))).toBe(true);
      await page.getByRole("button", { name: "Record shot", exact: true }).tap();
      await expect(page.getByText("● REC 2s", { exact: true })).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "Stop recording" }).tap();
      await expect(live).toHaveAttribute("src", /shot-1/, { timeout: 30_000 });

      // Retake returns shot 1 to the camera, then an upload replaces it (the fallback when a camera is refused).
      await page.getByRole("button", { name: "Retake", exact: true }).tap();
      await expect(page.getByRole("button", { name: "Open camera", exact: true })).toBeVisible();
      await page.locator("input[type=file]:not([capture])").setInputFiles(sample(1));
      await expect(page.locator(".camera-box video[src*='shot-1']")).toBeVisible({ timeout: 30_000 });
      await page.locator(".shot-progress button").nth(1).tap();
      await page.locator("input[type=file]:not([capture])").setInputFiles(sample(2));
      await expect(page.locator(".camera-box video[src*='shot-2']")).toBeVisible({ timeout: 30_000 });

      // Refresh mid-journey: the session in the address restores both saved shots.
      await expect(page).toHaveURL(/session=/);
      await page.reload();
      // Saved shots show a check mark whether or not they are the selected shot.
      await expect(page.locator(".shot-progress button span svg")).toHaveCount(2, { timeout: 30_000 });
      await expect(page.locator(".camera-box video[src*='shot-2']")).toBeVisible();

      // Network drop during the third upload: an honest error and a retry that keeps the chosen file.
      await page.locator(".shot-progress button").nth(2).tap();
      await context.setOffline(true);
      await page.locator("input[type=file]:not([capture])").setInputFiles(sample(3));
      await expect(page.getByRole("button", { name: "Retry saved upload" })).toBeVisible({ timeout: 30_000 });
      await context.setOffline(false);
      await page.getByRole("button", { name: "Retry saved upload" }).tap();
      await expect(page.locator(".camera-box video[src*='shot-3']")).toBeVisible({ timeout: 30_000 });

      // Every primary action stays inside the phone viewport (no hidden "next" button).
      const continueButton = page.getByRole("button", { name: /Review three shots/ });
      await expect(continueButton).toBeInViewport();
      await continueButton.tap();
      await page.getByRole("button", { name: /Customize reel/ }).tap();
      await expect(page.getByRole("button", { name: "Generate MP4" })).toBeInViewport();
      await page.getByRole("button", { name: "Generate MP4" }).tap();
      await expect(page.getByRole("heading", { name: "Made from your moments." })).toBeVisible({ timeout: 180_000 });
      await expect.poll(() => page.locator(".final-video video").evaluate((video: HTMLVideoElement) => video.readyState >= 2 && video.duration > 3), { timeout: 30_000 }).toBe(true);

      const download = page.waitForEvent("download");
      await page.getByRole("link", { name: /Download MP4/ }).tap();
      const file = await download; const saved = test.info().outputPath(file.suggestedFilename()); await file.saveAs(saved);
      expect(file.suggestedFilename()).toMatch(/\.mp4$/);
      const probe = JSON.parse(execFileSync(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height", "-of", "json", saved], { encoding: "utf8" })) as { streams: { codec_type: string; codec_name: string; width?: number; height?: number }[] };
      expect(probe.streams.find((stream) => stream.codec_type === "video")).toMatchObject({ codec_name: "h264", width: 720, height: 1280 });
      expect(probe.streams.some((stream) => stream.codec_type === "audio")).toBe(true);
      // The soundtrack must actually be audible, not just present as a silent track.
      const volume = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-i", saved, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
      const mean = Number(/mean_volume: (-?[\d.]+) dB/.exec(volume.stderr)?.[1]);
      expect(mean).toBeGreaterThan(-40);
      expect(errors).toEqual([]);
    });
  });
}

test("several visitors uploading at the same moment all succeed without seeing an error", async ({ browser }) => {
  test.setTimeout(180_000);
  // Real-footage fixtures take longest to prepare, which is what makes uploads overlap; samples are the offline fallback.
  const fixture = path.join(process.cwd(), "data", "fixtures", "tos-walk-portrait.mp4");
  const clip = existsSync(fixture) ? fixture : sample(1);
  const visitors = await Promise.all(Array.from({ length: 4 }, async () => {
    const context = await browser.newContext({ viewport: devices["Pixel 7"].viewport, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto("/festival");
    await page.getByRole("button", { name: "Start Creating" }).tap();
    await page.locator(".preset .card-action").first().tap();
    await page.getByRole("button", { name: "Use this shot plan" }).tap();
    return { context, page };
  }));
  await Promise.all(visitors.map(({ page }) => page.locator("input[type=file]:not([capture])").setInputFiles(clip)));
  for (const { page } of visitors) {
    await expect(page.locator(".camera-box video[src*='shot-1']")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("button", { name: "Retry saved upload" })).toHaveCount(0);
    await expect(page.locator(".error")).toHaveCount(0);
  }
  await Promise.all(visitors.map(({ context }) => context.close()));
});
