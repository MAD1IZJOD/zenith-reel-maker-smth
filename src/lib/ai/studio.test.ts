import assert from "node:assert/strict";
import test from "node:test";
import { createStudioAssist } from "./studio";
import { getPreset } from "@/lib/presets";

test("director produces three safe, preset-specific advanced shot guides", () => {
  const assist = createStudioAssist(getPreset("movie-trailer")!, { vibe: "dramatic", challenge: "Silent Storytelling", advanced: true });
  assert.equal(assist.director.length, 3);
  assert.match(assist.director[0].direction, /Silent Storytelling/);
  assert.equal(assist.director[1].angle, "Eye-level close or side angle");
  assert.equal(assist.director[2].duration, "3–8 seconds");
});

test("hook options are concise and do not require an external provider", () => {
  const assist = createStudioAssist(getPreset("squad-montage")!, { vibe: "energetic" });
  assert.equal(assist.hookOptions.length, 3);
  assert.ok(assist.hookOptions.every((hook) => hook.length <= 52));
  assert.match(assist.postCaption, /#SquadReelStudio/);
});
