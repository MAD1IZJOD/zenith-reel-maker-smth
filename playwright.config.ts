import { defineConfig } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
mkdirSync("data", { recursive: true });
const cameraFixture = path.resolve("data/browser-camera.y4m");
const operatorTestSecret = process.env.STUDIO_TEST_OPERATOR_SECRET || randomUUID() + randomUUID();
process.env.STUDIO_TEST_OPERATOR_SECRET = operatorTestSecret;
const installedChannel = process.platform === "win32" ? existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe") ? "chrome" : existsSync("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe") ? "msedge" : undefined : undefined;
execFileSync(process.env.FFMPEG_PATH || "ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=10", "-t", "3", "-pix_fmt", "yuv420p", cameraFixture], { stdio: "ignore", windowsHide: true });
export default defineConfig({
  testDir: "./tests/browser", timeout: 120_000, workers: 1, fullyParallel: false,
  reporter: [["list"]], outputDir: "data/browser-results",
  use: { baseURL: "http://localhost:3102", viewport: { width: 390, height: 844 }, trace: "retain-on-failure", channel: process.env.PLAYWRIGHT_CHANNEL || installedChannel, launchOptions: { args: ["--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${cameraFixture}`] } },
  webServer: { command: "node scripts/serve.mjs", url: "http://localhost:3102/api/ready", timeout: 60_000, reuseExistingServer: false, env: { NODE_ENV: "production", PORT: "3102", HOSTNAME: "127.0.0.1", COOKIE_SECURE: "false", PUBLIC_BASE_URL: "http://localhost:3102", DATA_DIR: "data/browser-tests", ENABLE_LEADERBOARD: "true", OPERATOR_SECRET: operatorTestSecret } },
});
