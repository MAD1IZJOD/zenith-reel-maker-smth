import "./isolated-data";
import assert from "node:assert/strict";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createSessionId, ensureSession } from "../src/lib/storage/session-storage";
import { renderReel, type RenderRequest } from "../src/lib/video/render";
import { runProcess, ffmpeg } from "../src/lib/video/process";
import { probeVideo } from "../src/lib/video/metadata";

async function main() {
  const sessionId = createSessionId(), directory = await ensureSession(sessionId);
  await Promise.all([1, 2, 3].map((i) => copyFile(path.resolve(`public/samples/shot-${i}.mp4`), path.join(directory, `shot-${i}.mp4`))));
  const base = { sessionId, presetId: "main-character", title: "The original title", captions: ["A clear beginning", "The action", "The payoff"] as [string, string, string] };
  // Samples the opening (hook) and a mid-edit moment where shot caption cards are on screen.
  async function frameHash(file: string, time: number, name: string) {
    const hash = createHash("sha256");
    for (const [index, at] of (time === 1 ? [1, 4.5] : [time]).entries()) {
      const image = path.join(directory, `${name}-${index}.png`);
      await runProcess(ffmpeg(), ["-y", "-v", "error", "-ss", String(at), "-i", file, "-frames:v", "1", image], "Finishing evidence frame");
      hash.update(await readFile(image));
    }
    return hash.digest("hex");
  }
  const baseline = await renderReel({ ...base, outputName: "baseline.mp4" });
  const baselineFrame = await frameHash(baseline.output, 1, "baseline-opening");
  const variants: [string, Partial<RenderRequest>][] = [
    ["hook", { hook: "A completely new opening" }],
    ["captions", { captionStyle: "high-energy" }],
    ["order", { shotOrder: [2, 1, 0] }],
    ["typography", { typographyStyle: "poster", closingTitle: "The final word", titleSeconds: 1 }],
    ["hidden-captions", { overlaysEnabled: false }],
    ["cover", { coverTitle: "A cover of our own", coverFrame: 2 }],
  ];
  const evidence: Record<string, unknown>[] = [];
  for (const [name, edit] of variants) {
    const result = await renderReel({ ...base, ...edit, outputName: `${name}.mp4` });
    const metadata = await probeVideo(result.output); assert.equal(metadata.width, 720); assert.equal(metadata.codecName, "h264");
    const frame = await frameHash(result.output, 1, name);
    if (name === "cover") {
      assert.equal(frame, baselineFrame, "cover-only changes must leave the movie untouched");
      assert.equal(result.cover, result.covers[2]);
      assert.notDeepEqual(await readFile(result.covers[0]), await readFile(baseline.covers[0]));
    } else assert.notEqual(frame, baselineFrame, `${name} must change decoded frames`);
    await runProcess(ffmpeg(), ["-v", "error", "-i", result.output, "-f", "null", "-"], "Finishing export full decode");
    evidence.push({ control: name, output: result.output, duration: metadata.duration, frameSha256: frame, cover: result.cover });
  }
  // Moving source demonstrates actual trimming; constant-color demo media cannot prove a seek.
  await runProcess(ffmpeg(), ["-y", "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=30:duration=4", "-c:v", "libx264", "-threads", "2", "-pix_fmt", "yuv420p", path.join(directory, "shot-1.mp4")], "Moving trim fixture");
  const untrimmed = await renderReel({ ...base, outputName: "untrimmed.mp4" });
  const trimmed = await renderReel({ ...base, trimStarts: [0.7, 0, 0], outputName: "trimmed.mp4" });
  assert.notEqual(await frameHash(untrimmed.output, 0.5, "untrimmed"), await frameHash(trimmed.output, 0.5, "trimmed"));
  evidence.push({ control: "trim", output: trimmed.output, source: untrimmed.output });
  await writeFile(path.join(directory, "finishing-evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ directory, evidence }, null, 2));
}
void main();
