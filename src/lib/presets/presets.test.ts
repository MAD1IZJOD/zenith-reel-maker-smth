import assert from "node:assert/strict";
import test from "node:test";
import { PRESETS, getPreset } from "./index";

test("seven complete, distinct render presets are available", () => {
  assert.equal(PRESETS.length, 7);
  assert.equal(new Set(PRESETS.map((preset) => preset.id)).size, 7);
  assert.equal(new Set(PRESETS.map((preset) => `${preset.effect}/${preset.transition}`)).size, 7);
  PRESETS.forEach((preset) => {
    assert.equal(preset.shots.length, 3);
    assert.equal(preset.captions.length, 3);
    assert.ok(preset.clipSeconds >= 2.5);
    assert.equal(getPreset(preset.id)?.name, preset.name);
  });
});
