import { expect, type Page } from "@playwright/test";
export async function registerCreator(page: Page) {
  const name = page.getByLabel("Your name", { exact: true });
  // Tests may revisit a URL with an existing registered session.
  await expect(name.or(page.getByRole("button", { name: /^(Start Creating|Create your reel|Find the best moments)$/ }))).toBeVisible();
  if (!await name.isVisible()) return;
  await name.fill("Browser Test");
  await page.getByLabel("Email address", { exact: true }).fill("browser-test@example.com");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue to the studio" }).click();
}
