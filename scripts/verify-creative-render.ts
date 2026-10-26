import "./isolated-data";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { createSessionId, ensureSession } from "../src/lib/storage/session-storage";
import { probeVideo } from "../src/lib/video/metadata";
import { ffmpeg, runProcess } from "../src/lib/video/process";
import { renderReel } from "../src/lib/video/render";

async function hash(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function main() {
  const sessionId = createSessionId();
  const directory = await ensureSession(sessionId);
  await Promise.all([1, 2, 3].map((shot) => copyFile(path.join(process.cwd(), "public", "samples", `shot-${shot}.mp4`), path.join(directory, `shot-${shot}.mp4`))));
  const source = path.join(directory, "shot-1.mp4");
  const voiced = path.join(directory, "shot-1-audio.mp4");
  await runProcess(ffmpeg(), ["-y", "-i", source, "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-shortest", voiced], "Audio fixture creation");
  await copyFile(voiced, source);
  assert.equal((await probeVideo(source)).hasAudio, true);

  const defaults = await renderReel({ sessionId, presetId: "main-character", title: "Creative proof", outputName: "default.mp4" });
  const customized = await renderReel({
    sessionId,
    presetId: "main-character",
    title: "100%: O'Neil [safe]; %{literal}",
    hook: "Quotes ' and commas, stay literal",
    captions: ["THIRD FIRST", "SECOND NOW", "FIRST LAST"],
    captionStyle: "high-energy",
    shotOrder: [2, 1, 0],
    audioMode: "original",
    outputName: "customized.mp4",
  });
  const [defaultMetadata, customMetadata, defaultHash, customHash] = await Promise.all([
    probeVideo(defaults.output),
    probeVideo(customized.output),
    hash(defaults.output),
    hash(customized.output),
  ]);
  assert.equal(customMetadata.hasAudio, true);
  assert.equal(customMetadata.codecName, "h264");
  assert.equal(customMetadata.width, 720);
  assert.equal(customMetadata.height, 1280);
  assert.equal(defaultMetadata.duration, customMetadata.duration);
  assert.notEqual(defaultHash, customHash, "creative options must change encoded output");
  console.log(JSON.stringify({ sessionId, default: defaults.output, customized: customized.output, hasAudio: customMetadata.hasAudio, defaultHash, customHash }, null, 2));
}

void main();
