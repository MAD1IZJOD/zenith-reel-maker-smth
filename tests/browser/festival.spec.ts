import { test, expect } from "@playwright/test";
import path from "node:path";

test("festival is usable at phone, tablet and desktop widths", async ({ page }) => {
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto("/festival");
    await expect(page.getByRole("heading", { name: "3 Shots. 1 Epic Reel." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start Creating" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `data/browser-results/festival-${width}.png`, fullPage: true });
  }
});

test("real upload, export, download, QR retrieval, consent and regeneration", async ({ page, browser }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/festival"); await page.getByRole("button", { name: "Reel Battle · Surprise Me" }).click();
  await expect(page.getByRole("heading", { name: "Here’s your three-shot plan." })).toBeVisible();
  await page.getByRole("button", { name: "Use this shot plan" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const selectors = page.locator('.shot-progress button');
  for (let shot = 1; shot <= 3; shot++) {
    await selectors.nth(shot - 1).click();
    await page.locator('input[type="file"]').last().setInputFiles(path.join(process.cwd(), "public", "samples", `shot-${shot}.mp4`));
    await expect(selectors.nth(shot - 1)).toHaveClass(/done|current/);
    await expect(page.getByText("Checking and preparing clip…")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator('.camera-box video')).toHaveAttribute("src", /api\/reels/);
  }
  await page.getByRole("button", { name: "Review three shots" }).click();
  await page.getByRole("button", { name: "Customize reel" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByLabel("Reel title").fill("Festival browser verification");
  await page.getByRole("button", { name: "Generate MP4" }).click();
  await expect(page.getByRole("heading", { name: "Made from your moments." })).toBeVisible({ timeout: 80_000 });
  const video = page.locator('.final-video video');
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  expect(await video.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBe(720);
  const downloadPromise = page.waitForEvent("download"); await page.getByRole("link", { name: "Download MP4", exact: true }).click();
  const download = await downloadPromise; expect(download.suggestedFilename()).toMatch(/\.mp4$/); await download.saveAs("data/browser-results/download.mp4");
  await page.getByRole("button", { name: "Create private QR link" }).click();
  const retrievalLink = page.getByRole("link", { name: "Open retrieval page" }); await expect(retrievalLink).toBeVisible();
  const url = await retrievalLink.getAttribute("href");
  const independent = await browser.newContext(); const retrieval = await independent.newPage(); await retrieval.goto(url!);
  await expect(retrieval.getByRole("heading", { name: "Festival browser verification" })).toBeVisible();
  await expect(retrieval.locator("video")).toHaveAttribute("src", /api\/retrieval/); await independent.close();
  await expect(page.getByRole("button", { name: "Request a public premiere" })).toBeDisabled();
  await expect(page.getByRole("heading", { name: /completion points/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByLabel("Permission for everyone shown").selectOption("adult");
  await page.getByRole("checkbox", { name: "Everyone shown agrees to this reel playing on the festival screen." }).check();
  await expect(page.getByRole("checkbox", { name: /Separately, allow the festival team/ })).not.toBeChecked();
  const submitted = page.waitForResponse((response) => response.url().endsWith("/api/premiere") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Request a public premiere" }).click();
  const premiereId = (await (await submitted).json()).entry.id;
  await expect(page.getByText("Status: pending", { exact: true })).toBeVisible();
  const operator = await page.context().newPage(); await operator.goto("/operator");
  await operator.getByLabel("Operator credential").fill(process.env.STUDIO_TEST_OPERATOR_SECRET!);
  await operator.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(operator.getByRole("heading", { name: "Screening review" })).toBeVisible();
  const submissionCard = operator.locator(`[data-submission-id="${premiereId}"]`);
  await submissionCard.getByRole("button", { name: "Approve screening" }).click();
  await expect(submissionCard.getByRole("button", { name: "Remove from screen" })).toBeVisible();
  const publicScreen = await page.context().newPage(); await publicScreen.goto("/display");
  await expect(publicScreen.locator("video")).toHaveAttribute("src", /api\/display/);
  await operator.getByRole("button", { name: "Pause public playback", exact: true }).click();
  await expect(publicScreen.getByText("SCREENINGS PAUSED", { exact: true })).toBeVisible({ timeout: 12_000 });
  await operator.getByRole("button", { name: "Resume public playback", exact: true }).click();
  await submissionCard.getByRole("button", { name: "Remove from screen" }).click();
  await expect(publicScreen.locator("video")).toHaveAttribute("src", /previews/, { timeout: 12_000 });
  await publicScreen.close(); await operator.close(); await page.bringToFront();
  await page.getByRole("button", { name: "Revoke screening and reuse permission" }).click();
  await expect(page.getByText(/Permission revoked. Future public playback/)).toBeVisible();
  await page.screenshot({ path: "data/browser-results/completed-reel-390.png", fullPage: true });
  await page.reload(); await expect(page.getByRole("heading", { name: "Made from your moments." })).toBeVisible();
  await page.route("**/api/sessions/*", async (route) => { if (route.request().method() === "GET") await route.abort(); else await route.continue(); });
  await page.reload(); await expect(page.getByRole("heading", { name: "Your saved reel is safe." })).toBeVisible();
  await page.unroute("**/api/sessions/*"); await page.getByRole("button", { name: "Retry session recovery" }).click();
  await expect(page.getByRole("heading", { name: "Made from your moments." })).toBeVisible();
  await page.getByRole("button", { name: "Try another preset" }).click();
  const retro = page.locator("article.preset").filter({ has: page.getByRole("heading", { name: "Retro Cam", exact: true }) });
  await retro.getByRole("button", { name: "Choose this style" }).click();
  await page.getByRole("button", { name: "Use this shot plan" }).click(); await page.getByRole("button", { name: "Review three shots" }).click();
  await page.getByRole("button", { name: "Customize reel" }).click(); await page.getByRole("button", { name: "Generate MP4" }).click();
  await expect(page.getByRole("heading", { name: "Made from your moments." })).toBeVisible({ timeout: 80_000 });
  await expect(page.getByRole("link", { name: /Download .*previous|Download Main|Download Beat|Download Glow|Download Plot|Download Squad|Download Movie|Download Retro/ })).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("synthetic browser camera records and cleans up; this is not a physical-device test", async ({ page, context }) => {
  await context.grantPermissions(["camera"]);
  await page.goto("/festival");
  const nativeProbe = await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    const chunks: Blob[] = []; const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
    let error = ""; recorder.ondataavailable = (event) => chunks.push(event.data); recorder.onerror = () => { error = "recorder-error"; };
    recorder.start(250); await new Promise((resolve) => setTimeout(resolve, 2000));
    if (recorder.state !== "inactive") { const stopped = new Promise((resolve) => { recorder.onstop = resolve; }); recorder.stop(); await stopped; }
    const result = { bytes: chunks.reduce((sum, chunk) => sum + chunk.size, 0), state: stream.getVideoTracks()[0].readyState, label: stream.getVideoTracks()[0].label, error }; stream.getTracks().forEach((track) => track.stop()); return result;
  });
  expect(nativeProbe.bytes).toBeGreaterThan(1024);
  expect(nativeProbe.error).toBe("");
  await page.goto("/festival"); await page.getByRole("button", { name: "Start Creating" }).click();
  await page.locator('.preset .card-action').first().click(); await page.getByRole("button", { name: "Use this shot plan" }).click();
  await page.getByRole("button", { name: "Open camera", exact: true }).click();
  const live = page.locator('.camera-box video');
  await expect.poll(() => live.evaluate((video: HTMLVideoElement) => Boolean(video.srcObject))).toBe(true);
  await page.getByRole("button", { name: "Record shot", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop recording" })).toBeVisible();
  // Wait for at least two seconds of actual browser-produced media, not a mocked upload.
  await expect(page.getByText("● REC 2s", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(live).toHaveAttribute("src", /api\/reels/, { timeout: 30_000 });
  await page.getByRole("button", { name: "Retake", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open camera", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open camera", exact: true }).click();
  await expect.poll(() => live.evaluate((video: HTMLVideoElement) => Boolean(video.srcObject))).toBe(true);
  const track = await live.evaluateHandle((video: HTMLVideoElement) => (video.srcObject as MediaStream).getVideoTracks()[0]);
  await page.getByRole("button", { name: "Back to shot plan" }).click();
  await expect(page.locator(".camera-box")).toHaveCount(0);
  await expect.poll(() => track.evaluate((item) => item.readyState)).toBe("ended");
});

test("demo, operator sign-in boundary and empty public display", async ({ page }) => {
  await page.goto("/festival"); await page.getByRole("button", { name: "Try Demo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your three moments are saved." })).toBeVisible({ timeout: 30_000 });
  await page.goto("/operator"); await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await page.goto("/display"); await expect(page.getByRole("heading", { name: "3 Shots. 1 Epic Reel." })).toBeVisible();
  await expect(page.getByAltText("Scan to open the public festival creator page")).toBeVisible();
  await expect(page.locator("video")).toHaveAttribute("src", /previews/);
});

test("camera permission denial offers an upload path", async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Browser.setPermission", { permission: { name: "camera" }, setting: "denied", origin: "http://localhost:3102" });
  await page.goto("/festival"); await page.getByRole("button", { name: "Start Creating" }).click();
  await page.locator('.preset .card-action').first().click(); await page.getByRole("button", { name: "Use this shot plan" }).click();
  await page.getByRole("button", { name: "Open camera", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Camera permission was denied" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload video", exact: true })).toBeEnabled();
  await page.locator('input[type="file"]').last().setInputFiles(path.join(process.cwd(), "public", "samples", "shot-1.mp4"));
  await expect(page.locator('.camera-box video')).toHaveAttribute("src", /api\/reels/, { timeout: 30_000 });
});
