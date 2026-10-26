import test from "node:test";
import assert from "node:assert/strict";
import { assessShot } from "./shot-analysis";
import { shotSuggestions } from "../creative/shot-coach";
const clip = { duration: 4, width: 720, height: 1280, codecName: "h264", formatName: "mp4", hasAudio: false };
test("coach distinguishes technical validity from explainable suggestions", () => {
  assert.deepEqual(assessShot(clip, [100, 110, 120]).issues, []);
  const short = assessShot({ ...clip, duration: 0.7, width: 240, height: 320 }, [18, 22, 20]);
  assert.equal(short.technicalValidity, "valid");
  assert.deepEqual(short.issues, ["short", "dark", "low-resolution"]);
  assert.equal(shotSuggestions(short, 3).length, 2);
  assert.match(shotSuggestions(short, 3)[0], /hold its final frame/);
  assert.equal(assessShot({ ...clip, rotation: 90 }).orientation, "landscape");
  assert.ok(assessShot(clip, [230, 232]).issues.includes("bright"));
  assert.equal(assessShot(clip).brightness, undefined);
});
