import { NextResponse } from "next/server";
import { ffmpeg, ffprobe, runProcess } from "@/lib/video/process";

export const runtime = "nodejs";

export async function GET() {
  try {
    await Promise.all([runProcess(ffmpeg(), ["-version"], "FFmpeg health check", 10_000), runProcess(ffprobe(), ["-version"], "FFprobe health check", 10_000)]);
    return NextResponse.json({ status: "ok", videoPipeline: "available" });
  } catch (error) {
    return NextResponse.json({ status: "unavailable", videoPipeline: "unavailable", error: error instanceof Error ? error.message : "FFmpeg is unavailable." }, { status: 503 });
  }
}
