import { expect, test } from "@playwright/test";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const dialogue = path.resolve("data/fixtures/tos-dialogue.mp4");

test("landing offers both creation modes and the podcast page refuses unsafe links", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("group", { name: "How do you want to create?" })).toBeVisible();
  await page.getByRole("link", { name: /Create from video \/ podcast/ }).click();
  await expect(page.getByRole("heading", { name: "Find the moments worth sharing." })).toBeVisible();
  await expect(page.getByRole("button", { name: /generate/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Direct media link" }).click();
  await page.getByRole("checkbox").check();
  await page.getByLabel("Link to a media file").fill("http://169.254.169.254/latest/meta-data");
  await page.getByRole("button", { name: "Import from link" }).click();
  await expect(page.locator(".error[role=alert]")).toContainText(/private network/);
  await page.getByLabel("Link to a media file").fill("https://www.youtube.com/watch?v=abc");
  await page.getByRole("button", { name: "Import from link" }).click();
  await expect(page.locator(".error[role=alert]")).toContainText(/creator tools/);
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `data/browser-results/podcast-${width}.png`, fullPage: true });
  }
});

test("a large real recording uploads, transcribes locally and yields highlight candidates", async ({ page }) => {
  test.skip(!existsSync(dialogue), "Run `npm run fixtures:fetch` for the CC-BY dialogue fixture.");
  test.setTimeout(300_000);
  expect(statSync(dialogue).size).toBeGreaterThan(10 * 1048576);
  await page.goto("/podcast");
  await page.getByRole("checkbox").check();
  await page.locator('input[type=file][accept="video/*,audio/*"]').setInputFiles(dialogue);
  await expect(page.getByRole("button", { name: /^tos-dialogue\.mp4/ })).toContainText("1:02 · 1280 × 534 video", { timeout: 120_000 });
  await page.getByRole("button", { name: "Transcribe locally" }).click();
  await expect(page.getByText(/Transcribed locally with Whisper/)).toBeVisible({ timeout: 240_000 });
  await expect(page.locator(".transcript-preview li").first()).toContainText(/\d:\d\d/);
  await page.getByRole("button", { name: "Find highlights" }).click();
  await expect(page.locator(".candidate-card").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/ranked by a transparent heuristic/)).toBeVisible();
  await expect(page.locator(".candidate-card video").first()).toHaveAttribute("src", /#t=\d+\.\d,\d+\.\d$/);
  await expect(page.getByText(/Next release: generate these/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Transcribed locally with Whisper/)).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: "data/browser-results/podcast-highlights-390.png", fullPage: true });
});
