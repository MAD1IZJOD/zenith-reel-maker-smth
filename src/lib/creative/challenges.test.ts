import test from "node:test";
import assert from "node:assert/strict";
import { CHALLENGES, challengeResult } from "./challenges";
import { defaultCreativeOptions } from "./options";
import { PRESETS } from "@/lib/presets";
import type { ReelJob } from "@/lib/jobs/queue";
test("challenges have three safe directions and scoring uses verified job facts", () => {
  assert.equal(new Set(CHALLENGES.map((challenge) => challenge.id)).size, 7);
  for (const challenge of CHALLENGES) assert.equal(challenge.shots.length, 3);
  const job: ReelJob = { id: "example", sessionId: "example", presetId: "main-character", title: "My own title", creative: defaultCreativeOptions(PRESETS[0]), consent: { publicDisplay: false, promoReuse: false }, stage: "rendering", metrics: {}, createdAt: Date.now(), expiresAt: Date.now() + 10000, challengeId: "entrance" };
  assert.equal(challengeResult(job), undefined);
  job.stage = "completed"; assert.equal(challengeResult(job)?.score, 100);
  job.presetId = "retro-cam"; assert.equal(challengeResult(job)?.score, 80);
});
