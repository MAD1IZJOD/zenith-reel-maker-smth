import path from "node:path";
import { NextResponse } from "next/server";
import { assertSessionId } from "@/lib/storage/session-storage";
import { errorResponse, HttpError, networkKey, rateLimit, requireSession } from "@/lib/server/security";
import { createSource, finishIngest, ingestsInFlight, listSources, saveSource, sourceDirectory, sourceLimits, track } from "@/lib/sources/store";
import { assertPublicHost, parseMediaUrl, UnsafeUrlError } from "@/lib/sources/url-safety";
import { downloadMedia } from "@/lib/sources/download";
import { countSafely } from "@/lib/festival/metrics";
import { requirePodcastMode } from "@/lib/server/features";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requirePodcastMode();
    const sessionId = assertSessionId(new URL(request.url).searchParams.get("sessionId") || "");
    await requireSession(request, sessionId);
    return NextResponse.json({ sources: await listSources(sessionId), limits: { maxMegabytes: Math.round(sourceLimits().maxBytes / 1048576), maxMinutes: Math.round(sourceLimits().maxSeconds / 60) } });
  } catch (error) { return errorResponse(error); }
}

/** Imports from a direct, public media link. The download runs in the background; poll the source for status. */
export async function POST(request: Request) {
  try {
    await requirePodcastMode();
    const body = await request.json() as { sessionId?: string; url?: string; rightsConfirmed?: boolean };
    const sessionId = assertSessionId(body.sessionId || "");
    await requireSession(request, sessionId);
    rateLimit(`source-url:${networkKey(request)}`, 6);
    if (body.rightsConfirmed !== true) throw new HttpError(400, "Confirm that you own this media or have permission to make clips from it.");
    let url: URL;
    try { url = parseMediaUrl(String(body.url || "")); await assertPublicHost(url); } catch (error) { throw new HttpError(400, error instanceof UnsafeUrlError ? error.message : "This link cannot be used."); }
    if (ingestsInFlight() >= 2) throw new HttpError(429, "Other imports are running. Please try again in a minute.");
    const record = await createSource(sessionId, "url", `${url.hostname}${path.posix.basename(url.pathname) ? ` · ${decodeURIComponent(path.posix.basename(url.pathname)).slice(0, 60)}` : ""}`);
    const target = path.join(sourceDirectory(sessionId, record.id), "download.part");
    void track(record.id, async () => {
      try {
        const { maxBytes } = sourceLimits();
        await downloadMedia(url.toString(), target, { maxBytes, timeoutMs: 15 * 60_000 });
        const result = await finishIngest(record, target);
        if (result.status === "ready") countSafely("source_imported");
      } catch (error) {
        await saveSource({ ...record, status: "failed", error: error instanceof UnsafeUrlError ? error.message : "The media could not be downloaded." });
      }
    });
    return NextResponse.json({ source: record }, { status: 202 });
  } catch (error) { return errorResponse(error, "Could not start this import."); }
}
