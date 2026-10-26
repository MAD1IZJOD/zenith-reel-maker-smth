import { expect, test } from "@playwright/test";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const dialogue = path.resolve("data/fixtures/tos-dialogue.mp4");
const lecture = path.resolve("data/fixtures/art_of_war_01-02_sun_tzu_64kb.mp3");

test("landing offers both creation modes; podcast links are validated safely", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Your footage. Your story. Beautifully edited.")).toBeVisible();
  await page.getByRole("link", { name: /Podcast to reels/ }).click();
  await expect(page.getByRole("heading", { name: "Turn long videos into short reels." })).toBeVisible();
  await expect(page.getByRole("button", { name: /generate/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Paste a video link" }).click();
  await page.getByRole("checkbox").check();
  for (const [url, message] of [["http://169.254.169.254/latest/meta-data", /private network/], ["https://www.youtube.com/watch?v=abc", /creator tools/]] as const) {
    await page.getByLabel("Link to a video or audio file").fill(url);
    await page.getByRole("button", { name: "Find the best moments" }).click();
    await expect(page.locator(".error[role=alert]")).toContainText(message);
    await expect(page.getByRole("heading", { name: "Turn long videos into short reels." })).toBeVisible();
  }
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `data/browser-results/podcast-input-${width}.png`, fullPage: true });
  }
});

test("one real recording becomes three captioned reels with previews, downloads, ZIP, a title edit and refresh recovery", async ({ page }) => {
  test.skip(!existsSync(lecture), "Run `npm run fixtures:fetch` for the public-domain spoken-word fixture.");
  test.setTimeout(480_000);
  await page.goto("/podcast");
  await page.getByRole("radio", { name: "15–30 s" }).click();
  await page.getByRole("checkbox").check();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Find the best moments" }).click();
  await (await chooser).setFiles(lecture);
  await expect(page.getByRole("heading", { name: /Transcribing speech|Finding highlights|Preparing your video/ })).toBeVisible();
  await expect(page.getByText("YOUR HIGHLIGHTS", { exact: true })).toBeVisible({ timeout: 240_000 });
  const cards = page.locator(".highlight-card");
  await expect(cards).toHaveCount(3);
  const count = 3;
  await expect(page.getByText(/Ranked by Zenith's editorial rules/)).toBeVisible();
  await cards.first().getByLabel("Title").fill("Strategy begins before the battle");
  await page.screenshot({ path: "data/browser-results/podcast-review-390.png", fullPage: true });
  await page.getByRole("button", { name: "Choose a style" }).click();
  await expect(page.getByRole("radio", { name: /Original video/ })).toBeDisabled();
  await page.getByRole("radio", { name: /Cinematic Quote/ }).click();
  await page.getByRole("radio", { name: "Creator Pop" }).click();
  await page.getByLabel("Soundtrack").selectOption("drift");
  await page.getByRole("button", { name: new RegExp(`Generate ${count} reels`) }).click();
  await expect(page.getByText("YOUR REELS", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ready to post." })).toBeVisible({ timeout: 240_000 });

  await page.setViewportSize({ width: 1440, height: 1000 });
  const videos = page.locator(".reel-card video");
  await expect(videos).toHaveCount(count);
  for (let index = 0; index < count; index++) await expect.poll(() => videos.nth(index).evaluate((video: HTMLVideoElement) => video.readyState >= 1 ? video.duration : 0), { timeout: 30_000 }).toBeGreaterThan(5);
  await expect(page.locator(".reel-card h3").first()).toHaveText("Strategy begins before the battle");
  await page.screenshot({ path: "data/browser-results/podcast-gallery-1440.png", fullPage: true });

  const download = page.waitForEvent("download");
  await page.locator(".reel-card").first().getByRole("link", { name: "Download" }).click();
  expect((await download).suggestedFilename()).toBe("zenith-reel-01.mp4");
  const zip = await page.request.get(await page.getByRole("link", { name: /Download all/ }).getAttribute("href") as string);
  expect(zip.headers()["content-type"]).toBe("application/zip");
  expect((await zip.body()).subarray(0, 4).toString("hex")).toBe("504b0304");

  const second = page.locator(".reel-card").nth(1);
  await second.getByText("Edit title").click();
  await second.getByLabel("Title").fill("A new title for reel two");
  await second.getByRole("button", { name: "Apply and re-render this reel" }).click();
  await expect(second.locator("h3")).toHaveText("A new title for reel two");
  await expect(page.getByRole("heading", { name: "Ready to post." })).toBeVisible({ timeout: 120_000 });

  await page.reload();
  await expect(page.getByText("YOUR REELS", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".reel-card h3").nth(1)).toHaveText("A new title for reel two");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("tab", { name: /Reel 1/ })).toBeVisible();
  await page.getByRole("tab", { name: /Reel 2/ }).click();
  await expect(page.locator(".reel-card.active h3")).toHaveText("A new title for reel two");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "data/browser-results/podcast-gallery-390.png", fullPage: true });
});

test("a large video with only one strong moment says so and still makes that reel", async ({ page }) => {
  test.skip(!existsSync(dialogue), "Run `npm run fixtures:fetch` for the CC-BY dialogue fixture.");
  test.setTimeout(300_000);
  expect(statSync(dialogue).size).toBeGreaterThan(10 * 1048576);
  await page.goto("/podcast");
  await page.getByRole("radio", { name: "15–30 s" }).click();
  await page.getByRole("checkbox").check();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Find the best moments" }).click();
  await (await chooser).setFiles(dialogue);
  await expect(page.getByRole("heading", { name: "The moments this recording supports." })).toBeVisible({ timeout: 240_000 });
  await expect(page.locator(".stage-note")).toContainText(/supports 1 distinct/);
  await expect(page.locator(".highlight-card video")).toHaveCount(1);
  await page.getByRole("button", { name: "Choose a style" }).click();
  await page.getByRole("radio", { name: /Original video/ }).click();
  await page.getByRole("button", { name: "Generate 1 reel" }).click();
  await expect(page.getByRole("heading", { name: "Ready to post." })).toBeVisible({ timeout: 180_000 });
  await expect.poll(() => page.locator(".reel-card video").evaluate((video: HTMLVideoElement) => video.readyState >= 1 ? video.videoHeight : 0), { timeout: 30_000 }).toBe(1280);
});
