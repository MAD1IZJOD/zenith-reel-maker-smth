import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { assertSessionId, sessionDirectory } from "@/lib/storage/session-storage";

export const runtime = "nodejs";
function assetType(asset: string): string | undefined {
  if (/^shot-[1-3]\.mp4$/.test(asset) || /^reel-[a-f0-9-]{36}\.mp4$/i.test(asset)) return "video/mp4";
  if (/^cover-reel-[a-f0-9-]{36}-[1-3]\.jpg$/i.test(asset)) return "image/jpeg";
  return undefined;
}

export async function GET(_: Request, context: { params: Promise<{ sessionId: string; asset: string }> }) {
  try {
    const { sessionId, asset } = await context.params;
    assertSessionId(sessionId);
    const contentType = assetType(asset);
    if (!contentType) return new NextResponse("Not found", { status: 404 });
    const body = await readFile(path.join(sessionDirectory(sessionId), asset));
    return new NextResponse(body, { headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=3600" } });
  } catch { return new NextResponse("Not found", { status: 404 }); }
}
