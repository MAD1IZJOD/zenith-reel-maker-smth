import { NextResponse } from "next/server";
import { mediaHealthy } from "@/lib/server/health";

export const runtime = "nodejs";

export async function GET() {
  try {
    if (!await mediaHealthy()) throw new Error("Media unavailable");
    return NextResponse.json({ status: "ok", videoPipeline: "available" });
  } catch {
    return NextResponse.json({ status: "unavailable", videoPipeline: "unavailable", error: "FFmpeg or FFprobe is unavailable. Ask the stall operator to check the video installation." }, { status: 503 });
  }
}
