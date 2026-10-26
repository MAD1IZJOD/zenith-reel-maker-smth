import { transcriptionAvailability } from "@/lib/transcription/faster-whisper";
import { HttpError } from "./security";

export type PodcastAvailability = { enabled: boolean; reason: string };

/**
 * Podcast to reels is offered only where it can actually work. PODCAST_MODE=off hides it on purpose (for example at the
 * festival); otherwise ("auto", the default) it is enabled exactly when the local transcription environment loads.
 * This server-side decision gates both the pages and every podcast API route, so a hidden button is never the only guard.
 */
export async function podcastAvailability(env: Record<string, string | undefined> = process.env): Promise<PodcastAvailability> {
  const mode = (env.PODCAST_MODE || "auto").trim().toLowerCase();
  if (mode === "off") return { enabled: false, reason: "Podcast to reels is switched off for this event." };
  const transcription = await transcriptionAvailability();
  return transcription.available
    ? { enabled: true, reason: "" }
    : { enabled: false, reason: "Podcast to reels is unavailable on this server: speech transcription is not installed." };
}

/** Rejects podcast API requests before any upload, download, transcription or render work starts. */
export async function requirePodcastMode(): Promise<void> {
  const availability = await podcastAvailability();
  if (!availability.enabled) throw new HttpError(404, availability.reason);
}
