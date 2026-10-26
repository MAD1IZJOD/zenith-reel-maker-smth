import assert from "node:assert/strict";
import test from "node:test";
import { createTimeline } from "./timeline";
import { defaultCreativeOptions, parseCreativeOptions, validateCreativeInput } from "./options";
import { PRESETS } from "../presets";

test("defined beat grid controls actual transition starts and output duration", () => {
  const preset = PRESETS[0], defaults = defaultCreativeOptions(preset);
  const auto = createTimeline(preset, { ...defaults, syncMode: "auto" });
  assert.deepEqual(auto.cutPositions, [2, 4]); assert.equal(auto.totalDuration, 6);
  const fast = createTimeline(preset, { ...defaults, syncMode: "energetic" });
  assert.deepEqual(fast.cutPositions, [1, 2]); assert.equal(fast.totalDuration, 3);
  const slow = createTimeline(preset, { ...defaults, musicId: "drift", syncMode: "cinematic" });
  assert.ok(Math.abs(slow.totalDuration - 16) < 0.01);
  assert.ok(slow.cutPositions.every((time) => Math.abs(time / (60 / slow.bpm) - Math.round(time / (60 / slow.bpm))) < 0.001));
  const custom = createTimeline(preset, { ...defaults, syncMode: "custom", customSeconds: [1.5, 2, 3] });
  assert.equal(custom.totalDuration, 6.5);
  assert.throws(() => validateCreativeInput({ musicId: "../../private" }));
  assert.throws(() => validateCreativeInput({ customSeconds: [Infinity, 0, "movie=secret"] }));
  assert.equal(parseCreativeOptions({}, preset).syncMode, "preset");
});
