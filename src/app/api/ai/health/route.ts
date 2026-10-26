import { NextResponse } from "next/server";
import { creativeModel } from "@/lib/ai/provider";

export const runtime = "nodejs";

/** Model availability only: no endpoint address, paths or credentials are exposed. */
export async function GET() {
  const health = await creativeModel().health();
  return NextResponse.json({ available: health.available, runtime: health.runtime, model: health.model, reason: health.available ? undefined : "The local creative model is offline; rules-based planning is active." }, { headers: { "Cache-Control": "no-store" } });
}
