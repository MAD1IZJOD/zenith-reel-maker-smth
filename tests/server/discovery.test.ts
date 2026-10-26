import "../../scripts/isolated-data";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { discoverHighlights, editorialScore, faithfulHook, generateHighlights, LENGTH_PRESETS, selectDistinct, shortlist, snapInterval, topicBoundaries } from "@/lib/highlights/discover";
import { sentenceUnits, validateCandidate } from "@/lib/highlights/candidates";
import { transcriptSchema, type Transcript } from "@/lib/transcription/schema";
import { LocalModelProvider, providerConfig } from "@/lib/ai/provider";

/** A podcast-like fixture: sponsor intro, three topics, a story, advice, an enumeration, and an outro. */
const SCRIPT = [
  "This episode is brought to you by our sponsor. Use code ZENITH and subscribe to the newsletter.",
  "Why do most small teams struggle with pricing? The truth is they price for costs instead of value. Customers pay for the outcome you deliver. If you charge for hours, you cap your own growth. The key is to anchor the price to the result. That is why value pricing changes a business.",
  "Let me tell you a story. Years ago I was running a tiny bakery with my sister. One morning the oven broke an hour before opening. We carried every tray to the neighbour's kitchen across the street. We laughed the whole time and somehow sold out by noon. I remember thinking that the team mattered more than the oven.",
  "Four, keep your receipts. Five, check the calendar. Six, call the supplier.",
  "Here is the most useful habit I know. Never start the day by reading email. You should write down the one task that moves everything forward. Make sure you finish it before lunch. Remember that focus is a decision you make every morning. Always protect the first hour.",
  "Thanks for listening and visit our website for more episodes.",
];
function fixture(): Transcript {
  let cursor = 0.5;
  // Sentences are 0.5 s apart; paragraphs (topic changes) are separated by a 1.6 s pause, as in real speech.
  const segments = SCRIPT.flatMap((paragraph) => {
    const sentences = paragraph.match(/[^.?!]+[.?!]/g)!.map((sentence) => {
      const words = sentence.trim().split(/\s+/).map((text) => { const word = { text, start: Number(cursor.toFixed(3)), end: Number((cursor + 0.27).toFixed(3)) }; cursor += 0.33; return word; });
      cursor += 0.5;
      return { start: words[0].start, end: words[words.length - 1].end, text: sentence.trim(), words };
    });
    cursor += 1.1;
    return sentences;
  });
  return transcriptSchema.parse({ version: 1, engine: "faster-whisper", model: "base", language: "en", duration: Number((cursor + 1).toFixed(3)), wordTimestamps: true, segments });
}
const offline = () => new LocalModelProvider({ ...providerConfig({}), url: "http://127.0.0.1:9", timeoutMs: 1000 });

test("windows respect the chosen length, never cut a word and score with a transparent rubric", () => {
  const transcript = fixture();
  for (const length of ["short", "medium"] as const) {
    const [min, max] = LENGTH_PRESETS[length];
    for (const item of generateHighlights("source", "Episode 1", transcript, { length, tone: "general" })) {
      assert.ok(item.duration >= min - 0.5 && item.duration <= max + 1, `${length} ${item.duration}`);
      assert.deepEqual(validateCandidate({ ...item, engagementBasis: "heuristic", estimatedEngagement: item.editorialScore / 100, completeness: item.features.completeness, rationale: "", rankedBy: "heuristic", captionPlan: { style: "x", wordTimestamps: true, words: item.words } }, transcript, { minSeconds: min, maxSeconds: max, captionStyle: "clean-creator" }).filter((problem) => problem !== "duration"), []);
      assert.ok(item.editorialScore >= 0 && item.editorialScore <= 100);
    }
  }
  assert.equal(topicBoundaries(sentenceUnits(transcript)).length, sentenceUnits(transcript).length);
});

test("three distinct, non-overlapping moments are chosen, avoiding sponsor reads, outros and list fragments", async () => {
  const result = await discoverHighlights({ sourceId: "source", sourceLabel: "Episode 1", transcript: fixture(), preferences: { length: "short", tone: "general" }, provider: offline() });
  assert.equal(result.selected.length, 3, result.notice);
  assert.equal(result.rankedBy, "heuristic"); assert.match(result.fallbackReason!, /not reachable/);
  for (let index = 1; index < 3; index++) assert.ok(result.selected[index].start >= result.selected[index - 1].end + 0.5);
  const text = result.selected.map((item) => item.transcript).join(" ");
  assert.ok(!/sponsor|subscribe|visit our website/i.test(text), "boilerplate avoided");
  assert.ok(!result.selected.some((item) => /^Four,/.test(item.transcript)), "list fragment not used as an opening");
  assert.ok(/pricing|value/i.test(text) && /bakery|oven/i.test(text) && /email|focus/i.test(text), "one moment per topic");
  assert.deepEqual(new Set(result.selected.map((item) => item.role)), new Set(["attention", "takeaway", "story"]));
  for (const item of result.selected) {
    assert.ok(faithfulHook(item.hook, item.transcript), item.hook);
    assert.ok(item.postCaption.includes("Excerpt from Episode 1"));
  }
});

test("short or silent recordings explain the shortfall instead of inventing weak picks", async () => {
  const transcript = fixture();
  const short = { ...transcript, segments: transcript.segments.slice(0, 6), duration: transcript.segments[5].end + 1 };
  const limited = await discoverHighlights({ sourceId: "s", sourceLabel: "x", transcript: short, preferences: { length: "long", tone: "general" }, provider: offline() });
  assert.ok(limited.selected.length < 3); assert.match(limited.notice!, /supports/);
  const silent = await discoverHighlights({ sourceId: "s", sourceLabel: "x", transcript: { ...transcript, segments: [] }, preferences: { length: "short", tone: "general" }, provider: offline() });
  assert.equal(silent.selected.length, 0); assert.match(silent.notice!, /No speech/);
});

test("hooks must stay faithful: no invented numbers or unrelated claims", () => {
  const spoken = "A lot of founders underestimate how expensive customer acquisition becomes.";
  assert.equal(faithfulHook("Why customer acquisition surprises founders", spoken), true);
  assert.equal(faithfulHook("This founder lost $10 million overnight", spoken), false);
  assert.equal(faithfulHook("Aliens built the pyramids", spoken), false);
});

test("model ranking may only reorder known candidates; unfaithful hooks and invented ids are discarded", async () => {
  const transcript = fixture();
  const pool = shortlist(generateHighlights("source", "Episode 1", transcript, { length: "short", tone: "general" }), 12);
  const known = pool[pool.length - 1];
  const reply = { rankings: [
    { candidateId: known.id, editorialScore: 100, hook: "This founder lost $10 million overnight", suggestedTitle: known.title, reasons: ["clear takeaway"] },
    { candidateId: "ffffffffffffffff", editorialScore: 99, hook: "Invented", suggestedTitle: "Invented", reasons: [] },
  ] };
  const server = http.createServer((request, response) => { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(request.url === "/api/tags" ? { models: [{ name: "qwen3:8b" }] } : { message: { content: JSON.stringify(reply) } })); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await discoverHighlights({ sourceId: "source", sourceLabel: "Episode 1", transcript, preferences: { length: "short", tone: "general" }, provider: new LocalModelProvider({ ...providerConfig({}), url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, timeoutMs: 3000 }) });
    assert.equal(result.rankedBy, "qwen");
    const ranked = result.pool.find((item) => item.id === known.id)!;
    assert.equal(ranked.rankedBy, "qwen"); assert.notEqual(ranked.hook, "This founder lost $10 million overnight");
    assert.ok(!result.pool.some((item) => item.id === "ffffffffffffffff"));
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test("visitor trims snap to silence between words and stay within bounds", () => {
  const transcript = fixture();
  const word = transcript.segments[2].words![2];
  const snapped = snapInterval(transcript, word.start + 0.1, word.start + 20.1);
  assert.equal(snapped.start, word.start);
  assert.throws(() => snapInterval(transcript, 10, 12), /five seconds/);
  assert.throws(() => snapInterval({ ...transcript, duration: 500 }, 0, 200), /90 seconds/);
  assert.ok(selectDistinct([], 3).length === 0 && editorialScore({ hook: 0, completeness: 0, takeaway: 0, story: 0, emotion: 0, tone: 0, ending: 0, density: 0, emphasis: 0, coherence: 0, boilerplate: 1 }) === 0);
});
