import { NextResponse } from "next/server";
import { ffmpeg, ffprobe, runProcess } from "@/lib/video/process";

export const runtime = "nodejs";

export async function GET() {
  try {
    await Promise.all([runProcess(ffmpeg(), ["-version"], "FFmpeg health check", 10_000), runProcess(ffprobe(), ["-version"], "FFprobe health check", 10_000)]);
    return NextResponse.json({ status: "ok", videoPipeline: "available" });
  } catch {
    return NextResponse.json({ status: "unavailable", videoPipeline: "unavailable", error: "FFmpeg or FFprobe is unavailable. Ask the stall operator to check the video installation." }, { status: 503 });
  }
}
