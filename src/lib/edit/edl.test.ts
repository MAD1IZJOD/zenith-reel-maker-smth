import assert from "node:assert/strict";
import test from "node:test";
import { cleanOverlayText, edlDuration, parseEdl, segmentOffsets } from "./edl";
import { chooseStart, cropFor, planClipEdit, planHighlightEdit } from "./planner";
import { defaultCreativeOptions } from "@/lib/creative/options";
import { PRESETS, getPreset } from "@/lib/presets";
import { compileEdl } from "@/lib/video/compile";

const clip = { duration: 6, width: 1080, height: 1920, hasAudio: true };
const preset = getPreset("main-character")!;
const plan = () => planClipEdit({ preset, options: defaultCreativeOptions(preset), clips: [clip, clip, clip] });

test("every preset plans a valid, distinct edit from the same footage", () => {
  const signatures = new Set<string>();
  for (const item of PRESETS) {
    const edl = planClipEdit({ preset: item, options: defaultCreativeOptions(item), clips: [clip, clip, clip] });
    assert.equal(edl.segments.length, 3);
    assert.equal(edl.transitions.length, 2);
    assert.ok(edlDuration(edl) >= 6 && edlDuration(edl) <= 12, `${item.id} ${edlDuration(edl)}`);
    assert.ok(!edl.transitions.some((transition) => transition.type === "cut" && transition.duration !== 0));
    signatures.add(JSON.stringify([edl.grade, edl.transitions.map((t) => t.type), edl.segments.map((s) => [s.duration, s.motion]), edl.captionStyle]));
  }
  assert.equal(signatures.size, PRESETS.length);
});

test("plans are deterministic for regeneration", () => {
  assert.deepEqual(plan(), plan());
  const args = (edl: ReturnType<typeof plan>) => compileEdl(edl, { sourcePaths: ["a.mp4", "b.mp4", "c.mp4"], fontsDir: "fonts", videoAss: "v.ass", coverAss: "c.ass", output: "o.mp4", coverPattern: "cover-%d.jpg" });
  assert.deepEqual(args(plan()), args(plan()));
});

test("invalid plans are rejected before FFmpeg", () => {
  const valid = plan();
  assert.throws(() => parseEdl({ ...valid, segments: valid.segments.map((segment, index) => (index === 1 ? { ...segment, source: 9 } : segment)) }), /missing source/);
  assert.throws(() => parseEdl({ ...valid, grade: "sepia; rm -rf" }));
  assert.throws(() => parseEdl({ ...valid, transitions: [{ type: "glitch", duration: 0.3 }, valid.transitions[1]] }));
  assert.throws(() => parseEdl({ ...valid, transitions: [{ type: "dissolve", duration: 0 }, valid.transitions[1]] }), /invalid duration/);
  assert.throws(() => parseEdl({ ...valid, segments: valid.segments.map((segment) => ({ ...segment, duration: 60 })) }), /exceeds/);
  assert.throws(() => parseEdl({ ...valid, segments: valid.segments.map((segment) => ({ ...segment, start: 5.9 })) }), /after its source ends/);
  assert.throws(() => parseEdl({ ...valid, canvas: { width: 1080, height: 1080, fps: 30 } }));
  assert.throws(() => parseEdl({ ...valid, overlays: [{ role: "hook", text: "late", start: 30, end: 31 }] }), /outside the edit/);
  assert.throws(() => parseEdl({ ...valid, captions: [{ start: 2, end: 3, words: [{ text: "b", start: 2, end: 3 }] }, { start: 1, end: 1.5, words: [{ text: "a", start: 1, end: 1.5 }] }] }), /non-overlapping/);
});

test("overlay text is literal: control characters and ASS override syntax are removed", () => {
  assert.equal(cleanOverlayText("  Hi {\\fs200}there\\N\u0000 ", 60), "Hi fs200thereN");
  const edl = parseEdl({ ...plan(), overlays: [{ role: "hook", text: "{\\b1}Bold?", start: 0, end: 1 }] });
  assert.equal(edl.overlays[0].text, "b1Bold?");
});

test("segment offsets account for transition overlap", () => {
  const edl = plan();
  const offsets = segmentOffsets(edl);
  assert.equal(offsets[0], 0);
  assert.ok(Math.abs(offsets[1] - (edl.segments[0].duration - edl.transitions[0].duration)) < 0.001);
});

test("automatic trimming prefers measured action and avoids starting mid-word", () => {
  const motion = [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 30, 32, 35, 31, 30, 29, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  const busy = { duration: 6, width: 720, height: 1280, hasAudio: false, activity: { step: 0.2, motion, audio: [] } };
  const start = chooseStart(busy, 1.4, false);
  assert.ok(start >= 1.6 && start <= 2.2, `start ${start}`);
  const speech = Array.from({ length: 30 }, (_, index) => (index >= 8 && index <= 14 ? -18 : -70));
  const talking = { ...busy, hasAudio: true, activity: { step: 0.2, motion: motion.map(() => 5), audio: speech } };
  const spoken = chooseStart(talking, 1.6, true);
  assert.ok(spoken <= 1.6 && spoken + 1.6 >= 2.8, `speech window ${spoken}`);
  assert.equal(chooseStart({ ...busy, duration: 1 }, 2, false), 0);
});

test("landscape footage sits on a blurred fill; portrait footage fills the frame", () => {
  assert.equal(cropFor({ width: 1920, height: 1080 }), "fit-blur");
  assert.equal(cropFor({ width: 1080, height: 1920 }), "cover");
  const landscape = planClipEdit({ preset, options: defaultCreativeOptions(preset), clips: [{ ...clip, width: 1920, height: 1080 }, clip, clip] });
  assert.equal(landscape.segments[0].crop, "fit-blur");
});

test("quality profile renders at 1080x1920 and fast at 720x1280", () => {
  assert.deepEqual(plan().canvas, { width: 720, height: 1280, fps: 30 });
  const quality = planClipEdit({ preset, options: { ...defaultCreativeOptions(preset), profile: "quality" }, clips: [clip, clip, clip] });
  assert.deepEqual(quality.canvas, { width: 1080, height: 1920, fps: 30 });
});

test("speech captions use only real word timestamps; without a transcript, title cards are used", () => {
  const words = [{ text: "This", start: 0.5, end: 0.7 }, { text: "is", start: 0.72, end: 0.85 }, { text: "real.", start: 0.9, end: 1.3 }];
  const options = { ...defaultCreativeOptions(preset), audioMode: "original" as const, captionMode: "speech" as const, trimMode: "manual" as const };
  const speech = planClipEdit({ preset, options, clips: [clip, clip, clip], transcripts: [words, undefined, undefined] });
  assert.ok(speech.captions.length >= 1);
  assert.deepEqual(speech.captions.flatMap((group) => group.words.map((word) => word.start)), [0.5, 0.72, 0.9]);
  assert.ok(!speech.overlays.some((overlay) => overlay.role === "card"));
  const cards = planClipEdit({ preset, options: { ...options, captionMode: "speech" }, clips: [clip, clip, clip] });
  assert.equal(cards.captions.length, 0);
  assert.ok(cards.overlays.some((overlay) => overlay.role === "card"));
});

test("highlight plans keep source timestamps for long-form speech", () => {
  const edl = planHighlightEdit({ source: { duration: 600, width: 1920, height: 1080, hasAudio: true }, start: 120, end: 150, words: [{ text: "Hello", start: 121, end: 121.4 }, { text: "world", start: 121.5, end: 122 }], hook: "A hook", captionStyle: "podcast-pop", profile: "fast" });
  assert.equal(edl.segments[0].start, 120);
  assert.equal(edlDuration(edl), 30);
  assert.equal(edl.segments[0].crop, "fit-blur");
  assert.deepEqual(edl.captions[0].words.map((word) => word.start), [1, 1.5]);
});
