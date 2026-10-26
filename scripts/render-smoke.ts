import "./isolated-data";
import { copyFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { createSessionId, ensureSession } from "../src/lib/storage/session-storage";
import { probeVideo } from "../src/lib/video/metadata";
import { renderReel } from "../src/lib/video/render";

async function main() {
  const exports: { preset: string; output: string; metadata: unknown; sha256: string }[] = [];
  for (const presetId of ["retro-cam", "beat-sync"]) {
    const sessionId = createSessionId();
    const directory = await ensureSession(sessionId);
    for (let shot = 1; shot <= 3; shot += 1) await copyFile(path.join(process.cwd(), "public", "samples", `shot-${shot}.mp4`), path.join(directory, `shot-${shot}.mp4`));
    const result = await renderReel({ sessionId, presetId });
    const metadata = await probeVideo(result.output);
    if (metadata.width !== 720 || metadata.height !== 1280 || metadata.formatName.indexOf("mp4") === -1) throw new Error(`Unexpected export metadata: ${JSON.stringify(metadata)}`);
    exports.push({ preset: presetId, output: result.output, metadata, sha256: createHash("sha256").update(await readFile(result.output)).digest("hex") });
  }
  if (exports[0].sha256 === exports[1].sha256) throw new Error("Preset exports were unexpectedly identical.");
  console.log(JSON.stringify(exports, null, 2));
}

void main();
