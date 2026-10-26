import { NextResponse } from "next/server";
import { assertSessionId } from "@/lib/storage/session-storage";
import { errorResponse, requireSession } from "@/lib/server/security";
import { readSource, removeSource } from "@/lib/sources/store";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

async function authorize(request: Request) {
  const sessionId = assertSessionId(new URL(request.url).searchParams.get("sessionId") || "");
  await requireSession(request, sessionId);
  return sessionId;
}

export async function GET(request: Request, context: Context) {
  try { return NextResponse.json({ source: await readSource(await authorize(request), (await context.params).id) }); }
  catch (error) { return errorResponse(error, "Source not found."); }
}

export async function DELETE(request: Request, context: Context) {
  try { await removeSource(await authorize(request), (await context.params).id); return NextResponse.json({ removed: true }); }
  catch (error) { return errorResponse(error, "Could not remove this source."); }
}
