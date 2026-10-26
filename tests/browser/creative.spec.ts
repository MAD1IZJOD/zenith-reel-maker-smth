import { test, expect } from "@playwright/test";
import path from "node:path";

test("cinematic landing and accessible storyboard reflect real footage", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto("/");
    await expect(page).toHaveTitle("ZENITH AGENTIC REEL MAKER");
    await expect(page.getByRole("heading", { name: "Three shots. Infinite stories." })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `data/browser-results/zenith-landing-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".hero-panel").first()).toHaveCSS("transform", "none");
  await page.getByRole("button", { name: "Create your reel" }).click();
  await page.locator(".preset .card-action").first().click();
  const board = page.getByLabel("Three-shot storyboard");
  await expect(board).toHaveAttribute("data-renderer", "css-3d");
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(board.locator(".story-frame")).toHaveCount(3);
  await board.getByRole("button", { name: /Storyboard position 2/ }).focus(); await page.keyboard.press("Enter");
  await expect(board.getByRole("button", { name: /Storyboard position 2/ })).toHaveAttribute("aria-pressed", "true");
  await board.getByRole("button", { name: "Capture this shot" }).click();
  await page.locator('input[type="file"]').last().setInputFiles(path.join(process.cwd(), "public/samples/shot-2.mp4"));
  await expect(page.locator(".camera-box video")).toHaveAttribute("src", /api\/reels/, { timeout: 30_000 });
  await expect(page.getByLabel("Shot Coach assessment")).toBeVisible();
  await page.getByRole("button", { name: "Back to shot plan" }).click();
  await expect(board.getByRole("button", { name: /shot 2, complete/ })).toBeVisible();
  await expect(board.locator("video")).toHaveAttribute("src", /shot-2/);
  await page.screenshot({ path: "data/browser-results/zenith-storyboard-390.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("spatial motion and recording navigation stay usable without WebGL", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await page.getByRole("button", { name: "Explore sample shot 1" }).click();
  await expect(page.getByRole("button", { name: "Explore sample shot 1" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".hero-installation")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: "data/browser-results/zenith-motion-1440.png", fullPage: true });
  await page.getByRole("button", { name: "Create your reel" }).click();
  await expect(page.locator("article.preset")).toHaveCount(7);
  await expect(page.locator(".preset-art img")).toHaveCount(7);
  await page.screenshot({ path: "data/browser-results/zenith-presets-1440.png", fullPage: true });
  await page.locator(".preset .card-action").first().click();
  await page.getByRole("button", { name: /Storyboard position 3/ }).click();
  await expect(page.getByRole("button", { name: /Storyboard position 3/ })).not.toHaveCSS("transform", "none");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByRole("button", { name: /Storyboard position 3/ })).toHaveCSS("transform", "none");
  await page.getByRole("button", { name: "Capture this shot" }).click();
  await expect(page.locator(".storyboard")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open camera", exact: true })).toBeEnabled();
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("Remix Lab renders, compares and downloads two edits from one source", async ({ page }) => {
  await page.goto("/festival"); await page.getByRole("button", { name: "Try Demo", exact: true }).click();
  await page.getByRole("button", { name: "Customize reel" }).click({ timeout: 30_000 });
  await page.getByRole("button", { name: "Generate MP4" }).click();
  await expect(page.getByRole("heading", { name: "Made from your moments." })).toBeVisible({ timeout: 80_000 });
  const first = await page.locator(".final-video video").getAttribute("src");
  await page.getByRole("button", { name: "Open Remix Lab" }).click();
  await page.getByLabel("Remix style").selectOption("retro-cam");
  await page.getByRole("button", { name: "Render second style" }).click();
  await expect(page.getByRole("link", { name: "Download remix", exact: true })).toBeVisible({ timeout: 80_000 });
  const second = await page.locator(".comparison-panel.remix video").getAttribute("src"); expect(second).not.toBe(first);
  await page.locator(".comparison-panel.remix").getByRole("button", { name: "Choose favorite" }).click();
  await expect(page.getByRole("button", { name: "Your favorite" })).toBeVisible();
  const download = page.waitForEvent("download"); await page.getByRole("link", { name: "Download remix", exact: true }).click(); await (await download).saveAs("data/browser-results/remix.mp4");
  await page.getByRole("button", { name: "Original edit", exact: true }).click();
  await expect(page.locator(".comparison-panel.original video")).toHaveAttribute("src", first!);
  const originalDownload = page.waitForEvent("download"); await page.getByRole("link", { name: "Download original", exact: true }).click(); await (await originalDownload).saveAs("data/browser-results/remix-original.mp4");
  await page.setViewportSize({ width: 1440, height: 960 }); await page.getByRole("button", { name: "Play both from start" }).click();
  await expect.poll(() => page.locator(".comparison-panel video").evaluateAll((videos) => videos.every((video) => !(video as HTMLVideoElement).paused))).toBe(true);
  await page.screenshot({ path: "data/browser-results/zenith-remix-1440.png", fullPage: true });
  const session = new URL(page.url()).searchParams.get("session");
  await expect.poll(async () => (await (await page.request.get(`/api/sessions/${session}`)).json()).draft.favoriteId).toBeTruthy();
  await page.reload(); await expect(page.getByRole("heading", { name: "Same moments. A different story." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Your favorite" })).toBeVisible();
});

test("Beat Lab exports its selected timing and original soundtrack", async ({ page }) => {
  await page.goto("/festival"); await page.getByRole("button", { name: "Try Demo", exact: true }).click();
  await page.getByRole("button", { name: "Customize reel" }).click({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Beat Lab", exact: true }).click();
  await page.getByLabel("Audio source").selectOption("soundtrack");
  await page.getByLabel("Sync mode").selectOption("energetic");
  await expect(page.getByLabel("Measured soundtrack amplitude")).toBeVisible();
  await expect(page.getByLabel("Edit duration 3.0 seconds. Cuts at 1.0 and 2.0 seconds")).toBeVisible();
  await page.getByLabel(/Preview sequence/).fill("1.5");
  await expect(page.getByText("At 1.5s: recorded shot 2.", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "data/browser-results/zenith-beat-390.png", fullPage: true });
  await page.getByRole("button", { name: "Generate MP4" }).click();
  await expect(page.getByRole("heading", { name: "Made from your moments." })).toBeVisible({ timeout: 80_000 });
  await expect.poll(() => page.locator(".final-video video").evaluate((video: HTMLVideoElement) => video.duration)).toBeCloseTo(3, 0);
});

test("Finishing Studio submits Director plan, look, profile, title, captions, order, trim and cover controls to a real export", async ({ page }) => {
  await page.goto("/festival"); await page.getByRole("button", { name: "Try Demo", exact: true }).click();
  await page.getByRole("button", { name: "Customize reel" }).click({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Style", exact: true }).click();
  await page.getByRole("button", { name: "Ask the Director" }).click();
  await expect(page.getByText("Planned by studio rules.")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("combobox", { name: "Colour look", exact: true }).selectOption("warm-film");
  await page.getByRole("button", { name: /^Quality/ }).click();
  await page.getByRole("tab", { name: "Titles", exact: true }).click();
  await page.getByLabel("Reel name · cover and file name", { exact: true }).fill("Our first scene");
  await page.getByLabel("Closing title", { exact: true }).fill("A Zenith ending");
  await page.getByRole("combobox", { name: "Typography", exact: true }).selectOption("poster");
  await page.getByLabel(/Opening title duration/).fill("1.5");
  await page.getByRole("tab", { name: "Captions", exact: true }).click();
  await page.getByRole("combobox", { name: "Caption style", exact: true }).selectOption("high-energy");
  await page.getByLabel("Shot 1 overlay").fill("The real opening");
  await page.getByRole("tab", { name: "Shots", exact: true }).click();
  await page.getByRole("button", { name: "Move recorded shot 3 earlier" }).click();
  await page.getByRole("button", { name: "Move recorded shot 3 earlier" }).click();
  await page.getByLabel("Shot 3 start at (seconds)", { exact: true }).fill("0.5");
  await page.getByRole("button", { name: "Back to footage" }).click();
  await expect(page.getByRole("button", { name: /Storyboard position 1, shot 3/ })).toBeVisible();
  await page.getByRole("button", { name: "Customize reel" }).click();
  await expect(page.getByLabel("Reel name · cover and file name", { exact: true })).toHaveValue("Our first scene");
  await page.getByRole("tab", { name: "Cover", exact: true }).click();
  await page.getByLabel("Cover title", { exact: true }).fill("A frame to remember");
  await page.getByLabel("Default cover moment").selectOption("2");
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `data/browser-results/zenith-finishing-${width}.png`, fullPage: true });
  }
  const submitted = page.waitForRequest((request) => request.url().endsWith("/api/jobs") && request.method() === "POST");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Generate MP4" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Generate MP4" })).toBeInViewport();
  await page.getByRole("button", { name: "Generate MP4" }).click();
  const specification = (await submitted).postDataJSON();
  expect(specification.creative).toMatchObject({ closingTitle: "A Zenith ending", typographyStyle: "poster", captionStyle: "high-energy", shotOrder: [2, 0, 1], trimStarts: [0, 0, 0.5], trimMode: "manual", coverFrame: 2, coverTitle: "A frame to remember", grade: "warm-film", profile: "quality", planSource: "rules" });
  await expect(page.getByRole("heading", { name: "Made from your moments." })).toBeVisible({ timeout: 80_000 });
  await expect(page.locator(".final-video video")).toHaveAttribute("poster", /-3\.jpg$/);
  await expect(page.locator(".export-meta")).toContainText("1080 × 1920");
  const download = page.waitForEvent("download"); await page.getByRole("link", { name: "Download cover", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.jpg$/);
  await (await download).saveAs("data/browser-results/finished-cover.jpg");
});
