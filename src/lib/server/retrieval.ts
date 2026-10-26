import { getJob } from "@/lib/jobs/queue";
import { digest, HttpError, secretToken } from "./security";
import { recordPath, readJson, writeJson } from "./store";
export type Retrieval = { hash: string; jobId: string; expiresAt: number; revoked: boolean };
export async function createRetrieval(jobId: string) {
  const job = await getJob(jobId);
  if (!job || job.stage !== "completed") throw new HttpError(400, "Finish rendering before creating a retrieval link.");
  const token = secretToken();
  const record: Retrieval = { hash: digest(token), jobId, expiresAt: Math.min(job.expiresAt, Date.now() + 6 * 3_600_000), revoked: false };
  await writeJson(recordPath("retrieval", record.hash), record);
  return { token, expiresAt: record.expiresAt };
}
export async function resolveRetrieval(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(404, "This reel link is unavailable.");
  const record = await readJson<Retrieval>(recordPath("retrieval", digest(token)));
  if (!record || record.revoked || record.expiresAt <= Date.now()) throw new HttpError(410, "This reel link expired or was revoked.");
  const job = await getJob(record.jobId);
  if (!job || job.stage !== "completed" || !job.outputUrl) throw new HttpError(410, "This reel is no longer available.");
  return { record, job };
}
