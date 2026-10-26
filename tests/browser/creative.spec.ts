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
  await page.getByRole("button", { name: "Back to shot plan" }).click();
  await expect(board.getByRole("button", { name: /shot 2, complete/ })).toBeVisible();
  await expect(board.locator("video")).toHaveAttribute("src", /shot-2/);
  await page.screenshot({ path: "data/browser-results/zenith-storyboard-390.png", fullPage: true });
  expect(errors).toEqual([]);
});
