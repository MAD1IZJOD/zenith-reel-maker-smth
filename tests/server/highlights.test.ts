import "../../scripts/isolated-data";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { candidateWindows, highlightCandidateSchema, selectNonOverlapping, sentenceUnits, validateCandidate } from "@/lib/highlights/candidates";
import { rankCandidates } from "@/lib/highlights/rank";
import { importTranscript, transcriptSchema, transcriptWords, type Transcript } from "@/lib/transcription/schema";
import { LocalModelProvider, providerConfig } from "@/lib/ai/provider";
import { planHighlightEdit } from "@/lib/edit/planner";

/** Deterministic fixture: 30 sentences, 0.3s per word, 0.6s pauses between sentences. */
function fixture(): Transcript {
  const sentences = Array.from({ length: 30 }, (_, index) => {
    const length = 6 + (index % 5);
    const vocabulary = ["this", "clip", "talks", "about", "ideas", "with", "calm", "tone", "here", "again"];
    const words = Array.from({ length }, (__, word) => (word === 0 ? (index % 7 === 0 ? "Why" : "Today") : vocabulary[(index + word) % vocabulary.length]));
    words[length - 1] += index % 7 === 0 ? "?" : ".";
    return words;
  });
  let cursor = 1;
  const segments = sentences.map((words) => {
    const timed = words.map((text) => { const word = { text, start: Number(cursor.toFixed(3)), end: Number((cursor + 0.25).toFixed(3)) }; cursor += 0.3; return word; });
    cursor += 0.6;
    return { start: timed[0].start, end: timed[timed.length - 1].end, text: words.join(" "), words: timed };
  });
  return transcriptSchema.parse({ version: 1, engine: "faster-whisper", model: "base", language: "en", duration: Number((cursor + 1).toFixed(3)), wordTimestamps: true, segments });
}

test("windows follow sentence boundaries, respect duration limits and never cut a word", () => {
  const transcript = fixture();
  assert.equal(sentenceUnits(transcript).length, 30);
  const windows = candidateWindows("source-a", transcript);
  assert.ok(windows.length > 20);
  for (const candidate of windows) {
    assert.deepEqual(validateCandidate(candidate, transcript), [], `${candidate.start}-${candidate.end}`);
    assert.ok(highlightCandidateSchema.safeParse(candidate).success);
    assert.equal(candidate.engagementBasis, "heuristic");
    assert.match(candidate.rationale, /^Heuristic:/);
  }
  const deliberate = { ...windows[0], start: transcriptWords(transcript)[3].start + 0.1, duration: windows[0].end - (transcriptWords(transcript)[3].start + 0.1) };
  assert.ok(validateCandidate(deliberate, transcript).includes("starts mid-word"));
});

test("selection returns non-overlapping highlights in source order, preferring stronger openings", () => {
  const transcript = fixture();
  const chosen = selectNonOverlapping(candidateWindows("source-a", transcript), 3);
  assert.equal(chosen.length, 3);
  for (let index = 1; index < chosen.length; index++) assert.ok(chosen[index].start >= chosen[index - 1].end + 1);
  assert.ok(chosen.some((candidate) => candidate.hook.startsWith("Why")));
  assert.deepEqual(selectNonOverlapping(candidateWindows("source-a", transcript), 3), chosen, "deterministic");
});

test("SRT, WebVTT and JSON transcripts import without inventing word timing", () => {
  const srt = importTranscript("1\n00:00:01,000 --> 00:00:04,500\nHello there.\n\n2\n00:00:05,000 --> 00:00:09,000\n<i>Second</i> line here.\n", 20);
  assert.equal(srt.wordTimestamps, false); assert.equal(srt.segments.length, 2); assert.equal(srt.segments[1].text, "Second line here.");
  assert.deepEqual(transcriptWords(srt), []);
  const vtt = importTranscript("WEBVTT\n\n00:01.000 --> 00:03.250 align:start\nShort cue\n", 10);
  assert.equal(vtt.segments[0].end, 3.25);
  const json = importTranscript(JSON.stringify({ wordTimestamps: true, segments: [{ start: 0, end: 1, text: "Hi", words: [{ text: "Hi", start: 0.1, end: 0.4 }] }] }), 5);
  assert.equal(transcriptWords(json).length, 1);
  assert.throws(() => importTranscript("Just some plain words without times.", 10), /No timed cues/);
  assert.throws(() => importTranscript(JSON.stringify({ wordTimestamps: true, segments: [{ start: 5, end: 2, text: "bad" }] }), 10));
  assert.throws(() => importTranscript("1\n00:00:01,000 --> 00:01:30,000\nToo long\n", 10), /past the media/);
  const segmentsOnly = candidateWindows("source-b", { ...srt, duration: 100, segments: Array.from({ length: 12 }, (_, index) => ({ start: index * 6, end: index * 6 + 5, text: `Sentence ${index}.` })) });
  assert.ok(segmentsOnly.length > 0); assert.ok(segmentsOnly.every((candidate) => candidate.captionPlan.wordTimestamps === false));
});

test("a selected highlight becomes a valid single-source edit with word-timed captions", () => {
  const transcript = fixture();
  const [first] = selectNonOverlapping(candidateWindows("source-a", transcript), 1);
  const edl = planHighlightEdit({ source: { duration: transcript.duration, width: 1920, height: 1080, hasAudio: true }, start: first.start, end: first.end, words: transcriptWords(transcript), hook: first.hook, captionStyle: "podcast-pop", profile: "fast" });
  assert.equal(edl.segments[0].start, first.start);
  assert.ok(edl.captions.length > 0);
  assert.ok(edl.captions.every((group) => group.start >= 0 && group.end <= first.duration + 0.01));
});

test("model ranking only reorders known candidates and falls back on unknown ids or outages", async () => {
  const transcript = fixture();
  const pool = candidateWindows("source-a", transcript);
  const shortlist = selectNonOverlapping(pool, 8, 1);
  const runtime = async (reply: unknown) => {
    const server = http.createServer((request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(request.url === "/api/tags" ? { models: [{ name: "qwen3:8b" }] } : { message: { content: JSON.stringify(reply) } }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { provider: new LocalModelProvider({ ...providerConfig({}), url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, timeoutMs: 2000 }), close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
  };
  const good = await runtime({ rankings: shortlist.slice(0, 3).map((candidate, index) => ({ id: candidate.id, score: 90 - index * 10, hook: `Model hook ${index}`, topic: "topic", reason: "clear idea" })) });
  try {
    const ranked = await rankCandidates(pool, 3, good.provider);
    assert.equal(ranked.rankedBy, "qwen"); assert.equal(ranked.candidates.length, 3);
    assert.ok(ranked.candidates.every((candidate) => candidate.rankedBy === "qwen" && candidate.hook.startsWith("Model hook")));
  } finally { await good.close(); }
  const invented = await runtime({ rankings: [{ id: "0000000000000000", score: 99, hook: "Invented", topic: "x", reason: "y" }] });
  try {
    const fallback = await rankCandidates(pool, 3, invented.provider);
    assert.equal(fallback.rankedBy, "heuristic"); assert.match(fallback.fallbackReason!, /no known candidates/);
  } finally { await invented.close(); }
  const offline = await rankCandidates(pool, 3, new LocalModelProvider({ ...providerConfig({}), url: "http://127.0.0.1:9" }));
  assert.equal(offline.rankedBy, "heuristic"); assert.equal(offline.candidates.length, 3);
});
