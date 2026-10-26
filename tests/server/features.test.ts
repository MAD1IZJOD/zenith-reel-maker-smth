import "../../scripts/isolated-data";
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { podcastAvailability, requirePodcastMode } from "@/lib/server/features";

// Read when availability is first checked, not at import. Simulates a deployment host without the transcription environment (for example the container image).
process.env.TRANSCRIBE_PYTHON = path.join(process.cwd(), "data", "no-such-python", "python");

test("PODCAST_MODE=off disables podcast to reels regardless of the host", async () => {
  const availability = await podcastAvailability({ PODCAST_MODE: "off" });
  assert.equal(availability.enabled, false);
  assert.match(availability.reason, /switched off/);
});

test("auto mode disables podcast to reels when transcription cannot run, and the API guard refuses before any work", async () => {
  const availability = await podcastAvailability({});
  assert.equal(availability.enabled, false);
  assert.match(availability.reason, /transcription is not installed/);
  const previous = process.env.PODCAST_MODE; delete process.env.PODCAST_MODE;
  try { await assert.rejects(requirePodcastMode(), (error: Error & { status?: number }) => error.status === 404 && /unavailable on this server/.test(error.message)); }
  finally { if (previous !== undefined) process.env.PODCAST_MODE = previous; }
});
