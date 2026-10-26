import assert from "node:assert/strict";
import test from "node:test";
import { defaultCreativeOptions, parseCreativeOptions } from "./options";
import { getPreset } from "@/lib/presets";

const preset = getPreset("plot-twist")!;

test("creative options use safe preset defaults", () => {
  const options = defaultCreativeOptions(preset);
  assert.deepEqual(options.shotOrder, [0, 1, 2]);
  assert.equal(options.audioMode, "muted");
  assert.equal(options.captions.length, 3);
});

test("creative options reject unsafe values and sanitize overlay text", () => {
  const options = parseCreativeOptions({
    vibe: "dramatic",
    hook: "  A\u0000 safer hook  ",
    captions: ["First", "Second", "Third"],
    captionStyle: "bold",
    shotOrder: [2, 0, 1],
    audioMode: "original",
  }, preset);
  assert.equal(options.hook, "A safer hook");
  assert.deepEqual(options.shotOrder, [2, 0, 1]);
  assert.equal(options.audioMode, "original");
  assert.equal(parseCreativeOptions({ shotOrder: [0, 0, 1] }, preset).shotOrder.join(","), "0,1,2");
});
