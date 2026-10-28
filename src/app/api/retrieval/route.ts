import { readJsonBody } from "@/lib/server/request-body";
import { NextResponse } from "next/server";
import { getJob } from "@/lib/jobs/queue";
import { createRetrieval, resolveRetrieval } from "@/lib/server/retrieval";
import { errorResponse, HttpError, rateLimit, requireSession } from "@/lib/server/security";
import { recordPath, writeJson } from "@/lib/server/store";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const { jobId } = await readJsonBody(request); const job = await getJob(String(jobId));
    if (!job) throw new HttpError(404, "Reel not found.");
    await requireSession(request, job.sessionId); rateLimit(`retrieval:${job.sessionId}`, 12);
    const result = await createRetrieval(job.id);
    return NextResponse.json({ ...result, path: `/r/${result.token}` });
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request) {
  try {
    const { token } = await readJsonBody(request); const { record, job } = await resolveRetrieval(String(token));
    await requireSession(request, job.sessionId); record.revoked = true;
    await writeJson(recordPath("retrieval", record.hash), record);
    return NextResponse.json({ revoked: true });
  } catch (error) { return errorResponse(error); }
}
