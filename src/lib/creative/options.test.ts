import assert from "node:assert/strict";
import test from "node:test";
import { defaultCreativeOptions, parseCreativeOptions, validateCreativeInput } from "./options";
import { getPreset } from "@/lib/presets";

const preset = getPreset("plot-twist")!;

test("creative options use safe preset defaults", () => {
  const options = defaultCreativeOptions(preset);
  assert.deepEqual(options.shotOrder, [0, 1, 2]);
  assert.equal(options.audioMode, "muted");
  assert.equal(options.captions.length, 3);
});

test("finishing specifications are bounded and legacy drafts receive compatible defaults", () => {
  const legacy = parseCreativeOptions({ hook: "saved" }, preset);
  assert.equal(legacy.titleSeconds, 2.2); assert.deepEqual(legacy.trimStarts, [0, 0, 0]);
  assert.equal(legacy.overlaysEnabled, true); assert.equal(legacy.coverFrame, 0);
  for (const invalid of [{ trimStarts: [0, -2, 0] }, { typographyStyle: "drawtext=evil" }, { titleSeconds: 100 }, { coverFrame: 4 }, { overlaysEnabled: "false" }, { closingTitle: {} }, { captions: ["one"] }]) assert.throws(() => validateCreativeInput(invalid));
  assert.doesNotThrow(() => validateCreativeInput({ titleSeconds: 1, trimStarts: [0.5, 0, 0], typographyStyle: "poster", coverTitle: "100%: O'Neil", coverFrame: 2 }));
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
