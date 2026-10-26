import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { assertSessionId, sessionDirectory } from "@/lib/storage/session-storage";

export const runtime = "nodejs";
const assets: Record<string, string> = { "shot-1.mp4": "video/mp4", "shot-2.mp4": "video/mp4", "shot-3.mp4": "video/mp4", "reel.mp4": "video/mp4", "cover.jpg": "image/jpeg" };

export async function GET(_: Request, context: { params: Promise<{ sessionId: string; asset: string }> }) {
  try {
    const { sessionId, asset } = await context.params;
    assertSessionId(sessionId);
    if (!assets[asset]) return new NextResponse("Not found", { status: 404 });
    const body = await readFile(path.join(sessionDirectory(sessionId), asset));
    return new NextResponse(body, { headers: { "Content-Type": assets[asset], "Cache-Control": "private, max-age=3600" } });
  } catch { return new NextResponse("Not found", { status: 404 }); }
}
