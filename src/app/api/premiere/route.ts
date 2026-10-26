import { NextResponse } from "next/server";
import { getJob } from "@/lib/jobs/queue";
import { getPremiere, submitPremiere, updatePremiere, type Premiere } from "@/lib/festival/premiere";
import { records } from "@/lib/festival/records";
import { errorResponse, HttpError, rateLimit, requireSession } from "@/lib/server/security";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const job = await getJob(new URL(request.url).searchParams.get("jobId") || ""); if (!job) throw new HttpError(404, "Reel not found.");
    await requireSession(request, job.sessionId);
    const entry = (await records<Premiere>("premieres")).find((item) => item.jobId === job.id && item.expiresAt > Date.now());
    return NextResponse.json({ entry: entry ? { id: entry.id, status: entry.status } : null });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const body = await request.json(); const job = await getJob(String(body.jobId)); if (!job) throw new HttpError(404, "Reel not found.");
    await requireSession(request, job.sessionId); rateLimit(`premiere:${job.sessionId}`, 6);
    const entry = await submitPremiere(job.id, body.consentBasis, body.allPeopleAgree, body.promoReuse);
    return NextResponse.json({ entry: { id: entry.id, status: entry.status } });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request) {
  try {
    const { id } = await request.json(); const entry = await getPremiere(String(id)); await requireSession(request, entry.sessionId);
    await updatePremiere(entry.id, "revoked"); return NextResponse.json({ revoked: true });
  } catch (error) { return errorResponse(error); }
}
