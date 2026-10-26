import "./isolated-data";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { renderReel } from "../src/lib/video/render";
import { prepareFixtureSession, type FixtureKind } from "./fixtures";

/**
 * Renders representative reels from the CC BY fixtures for side-by-side quality review (not a pass/fail test).
 * Usage: tsx scripts/quality-sample.ts <label> [presetId...]; output lands in data/quality/<label>/ (ignored).
 * Extra creative options may be passed as JSON in QUALITY_OPTIONS.
 */
async function main() {
  const [label = "sample", ...presets] = process.argv.slice(2);
  const target = path.join(process.cwd(), "data", "quality", label); await mkdir(target, { recursive: true });
  const extra = process.env.QUALITY_OPTIONS ? JSON.parse(process.env.QUALITY_OPTIONS) : {};
  for (const kind of ["portrait", "landscape"] as FixtureKind[]) {
    const session = await prepareFixtureSession(kind);
    for (const presetId of presets.length ? presets : ["main-character", "glow-up"]) {
      const started = Date.now();
      const result = await renderReel({ sessionId: session.sessionId, presetId, outputName: `${presetId}-${kind}.mp4`, ...extra });
      await copyFile(result.output, path.join(target, `${presetId}-${kind}.mp4`));
      console.log(`${label} ${presetId} ${kind}: ${((Date.now() - started) / 1000).toFixed(1)}s`);
    }
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
