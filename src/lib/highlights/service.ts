import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readJson, writeJson } from "@/lib/server/store";
import { HttpError } from "@/lib/server/security";
import { readSource, sourceDirectory, sourceMediaPath } from "@/lib/sources/store";
import { readTranscript, transcriptPath } from "@/lib/transcription/service";
import { audioProfile } from "./audio-profile";
import { discoverHighlights, LENGTH_PRESETS, TONES, type Discovery, type Highlight, type Preferences } from "./discover";

export function parsePreferences(value: unknown): Preferences {
  const input = (typeof value === "object" && value ? value : {}) as Record<string, unknown>;
  return { length: typeof input.length === "string" && input.length in LENGTH_PRESETS ? input.length as Preferences["length"] : "medium", tone: (TONES as readonly unknown[]).includes(input.tone) ? input.tone as Preferences["tone"] : "general" };
}

/**
 * Analysis is cached per transcript content and preferences, so changing visual style, captions or music never
 * re-runs transcription or the model. `refresh` re-ranks (for example once a local model becomes available).
 */
export async function highlightsFor(sessionId: string, sourceId: string, preferences: Preferences, refresh = false): Promise<Discovery> {
  const source = await readSource(sessionId, sourceId);
  const transcript = await readTranscript(sessionId, sourceId);
  if (source.status !== "ready" || !transcript) throw new HttpError(409, "Transcribe this source before finding highlights.");
  const key = createHash("sha256").update(await readFile(transcriptPath(sessionId, sourceId))).update(JSON.stringify(preferences)).digest("hex").slice(0, 20);
  const cache = path.join(sourceDirectory(sessionId, sourceId), `highlights-${key}.json`);
  if (!refresh) { const cached = await readJson<Discovery>(cache).catch(() => undefined); if (cached) return cached; }
  const profile = await audioProfile(sourceDirectory(sessionId, sourceId), sourceMediaPath(sessionId, sourceId));
  const result = await discoverHighlights({ sourceId, sourceLabel: source.label, transcript, preferences, profile });
  await writeJson(cache, result);
  return result;
}

/** The visitor-facing view: no internal feature vectors. */
export const publicHighlight = (highlight: Highlight): Omit<Highlight, "features"> => { const copy: Partial<Highlight> = { ...highlight }; delete copy.features; return copy as Omit<Highlight, "features">; };
export const publicDiscovery = (discovery: Discovery) => ({ ...discovery, pool: discovery.pool.map(publicHighlight), selected: discovery.selected.map(publicHighlight) });
