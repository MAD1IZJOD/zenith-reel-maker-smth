import { exclusive, readJson, recordPath, writeJson } from "@/lib/server/store";
import { eventDay } from "./records";
type Counters = { day: string; counts: Record<string, number> };
const allowed = /^(sessions_started|camera_selected|upload_selected|clip_saved|reels_completed|render_failures|download_requests|premiere_opt_ins|preset_[a-z-]+|challenge_[a-z-]+)$/;
export async function countMetric(event: string) {
  if (!allowed.test(event)) return;
  const day = eventDay();
  await exclusive(`metrics:${day}`, async () => {
    const file = recordPath("metrics", day); const data = await readJson<Counters>(file) || { day, counts: {} };
    data.counts[event] = (data.counts[event] || 0) + 1; await writeJson(file, data);
  });
}
export const todayMetrics = () => readJson<Counters>(recordPath("metrics", eventDay()));
export function countSafely(event: string) { void countMetric(event).catch(() => console.error("Aggregate metric could not be persisted")); }
