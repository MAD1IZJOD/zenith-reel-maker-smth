import { test, expect } from "@playwright/test";

test("registration is required, survives refresh, and stays out of public UI", async ({ page }) => {
  await page.goto("/festival");
  await expect(page.getByRole("heading", { name: "Let’s meet the creator." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start Creating", exact: true })).toHaveCount(0);
  await page.getByLabel("Your name", { exact: true }).fill("Registration Test");
  await page.getByLabel("Email address", { exact: true }).fill("registration@example.com");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue to the studio" }).click();
  await expect(page.getByRole("button", { name: "Start Creating", exact: true })).toBeVisible();
  expect(page.url()).not.toContain("registration@example.com");
  await page.reload();
  await expect(page.getByRole("button", { name: "Start Creating", exact: true })).toBeVisible();
  await expect(page.getByLabel("Email address", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "data/browser-results/registration-complete.png" });
});

test("mobile registration retains typed details on a failed save", async ({ page }) => {
  await page.goto("/festival");
  await page.getByLabel("Your name", { exact: true }).fill("Retry Test");
  await page.getByLabel("Email address", { exact: true }).fill("retry@example.com");
  await page.getByRole("checkbox").check();
  await page.route("**/registration", async (route) => route.request().method() === "PUT" ? route.abort() : route.continue());
  await page.getByRole("button", { name: "Continue to the studio" }).click();
  await expect(page.locator(".registration-page [role=alert]")).toBeVisible();
  await expect(page.getByLabel("Email address", { exact: true })).toHaveValue("retry@example.com");
  await page.unroute("**/registration");
  await page.getByRole("button", { name: "Continue to the studio" }).click();
  await expect(page.getByRole("button", { name: "Start Creating", exact: true })).toBeVisible();
});
