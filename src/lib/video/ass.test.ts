import assert from "node:assert/strict";
import test from "node:test";
import { assTime, buildAss, CAPTION_LOOKS, fitScale, SAFE, wrapWords } from "./ass";
import { planClipEdit, planHighlightEdit } from "@/lib/edit/planner";
import { defaultCreativeOptions } from "@/lib/creative/options";
import { getPreset } from "@/lib/presets";
import { CAPTION_STYLES } from "@/lib/edit/styles";
import { groupWords } from "@/lib/captions/grouping";

const source = { duration: 120, width: 1080, height: 1920, hasAudio: true };
const words = [
  { text: "Honestly,", start: 1.0, end: 1.4 }, { text: "this", start: 1.45, end: 1.6 }, { text: "changed", start: 1.65, end: 2.0 },
  { text: "everything.", start: 2.05, end: 2.6 }, { text: "Supercalifragilisticexpialidocious", start: 3.4, end: 4.4 },
];
const events = (ass: string) => ass.split("\n").filter((line) => line.startsWith("Dialogue:"));

test("ASS times are centisecond precise", () => {
  assert.equal(assTime(0), "0:00:00.00");
  assert.equal(assTime(61.234), "0:01:01.23");
  assert.equal(assTime(3725.5), "1:02:05.50");
});

test("word captions highlight each real word for exactly its own time slice", () => {
  const edl = planHighlightEdit({ source, start: 0, end: 6, words, hook: "Hook", captionStyle: "clean-creator", profile: "fast" });
  const captionEvents = events(buildAss(edl, "video")).filter((line) => line.includes(",Caption,"));
  const totalWords = edl.captions.reduce((sum, group) => sum + group.words.length, 0);
  assert.equal(captionEvents.length, totalWords);
  assert.ok(captionEvents[1].startsWith("Dialogue: 1,0:00:01.45"), captionEvents[1]);
  assert.match(captionEvents[1], /\\c&H006DF4C4&\}THIS/i);
});

test("captions stay inside social-safe margins for every style and canvas", () => {
  for (const profile of ["fast", "quality"] as const) for (const style of CAPTION_STYLES) {
    const edl = planHighlightEdit({ source, start: 0, end: 6, words, hook: "Hook", captionStyle: style, profile });
    const ass = buildAss(edl, "video");
    const caption = ass.split("\n").find((line) => line.startsWith("Style: Caption"))!.split(",");
    const [marginL, marginR, marginV] = caption.slice(19, 22).map(Number);
    assert.ok(marginV >= edl.canvas.height * SAFE.bottom, `${style} bottom ${marginV}`);
    assert.ok(marginL >= edl.canvas.width * SAFE.side - 1 && marginR >= edl.canvas.width * SAFE.side - 1);
    const title = ass.split("\n").find((line) => line.startsWith("Style: Title"))!.split(",");
    assert.ok(Number(title[21]) >= edl.canvas.height * SAFE.top, "title below top app chrome");
  }
});

test("long words shrink to fit instead of overflowing; groups wrap into at most two balanced lines", () => {
  const look = CAPTION_LOOKS["high-energy"];
  assert.equal(fitScale(["HI"], look.font, look.size, 1080, false), 100);
  assert.ok(fitScale(["SUPERCALIFRAGILISTICEXPIALIDOCIOUS"], look.font, look.size, 1080, false) < 100);
  assert.deepEqual(wrapWords(["one", "two", "three", "four"], 9).map((line) => line.join(" ")), ["one two", "three four"]);
  assert.equal(wrapWords(["short"], 4).length, 1);
});

test("grouping respects pauses, punctuation and per-style limits without changing times", () => {
  const groups = groupWords(words, "clean-creator");
  assert.deepEqual(groups.map((group) => group.words.map((word) => word.text)), [["Honestly"], ["this", "changed"], ["everything"], ["Supercalifragilisticexpialidocious"]]);
  assert.equal(groups[1].words[0].start, 1.45);
  for (const [index, group] of groups.entries()) if (groups[index + 1]) assert.ok(group.end <= groups[index + 1].start);
  assert.ok(groupWords(words, "high-energy").every((group) => group.words.length <= 2));
});

test("special characters render literally; no transcript means no fabricated subtitles", () => {
  const preset = getPreset("plot-twist")!;
  const clip = { duration: 5, width: 1080, height: 1920, hasAudio: false };
  const options = { ...defaultCreativeOptions(preset), hook: "100%: O'Neil {\\b1} & co", captions: ["a,b", "c;d", "e=f"] as [string, string, string] };
  const ass = buildAss(planClipEdit({ preset, options, clips: [clip, clip, clip] }), "video");
  assert.ok(!/\\b1/.test(ass));
  assert.match(ass.replace(/\\N/g, " "), /100%: O'Neil b1 & co/);
  assert.ok(events(ass).every((line) => !line.includes("\\c&H")), "cards do not imitate word highlighting");
});

test("cover document contains only the cover title over a soft band", () => {
  const preset = getPreset("movie-trailer")!;
  const clip = { duration: 6, width: 1080, height: 1920, hasAudio: false };
  const ass = buildAss(planClipEdit({ preset, options: { ...defaultCreativeOptions(preset), coverTitle: "Our night" }, clips: [clip, clip, clip] }), "cover");
  const cover = events(ass);
  assert.equal(cover.length, 2);
  assert.match(cover[0], /\\p1/);
  assert.match(cover[1], /OUR NIGHT/);
});
