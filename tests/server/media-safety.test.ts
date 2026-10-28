import "../../scripts/isolated-data";
import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { probeVideo } from "@/lib/video/metadata";
import { probeMedia } from "@/lib/sources/store";
import { createMezzanine } from "@/lib/video/mezzanine";

test("disguised playlists cannot load another local media file during probing or decoding", async () => {
  const dir = await mkdtemp(path.join(process.cwd(), "data", "media-security-"));
  try {
    const manifest = path.join(dir, "upload.mp4");
    await copyFile(path.resolve("public/samples/shot-1.mp4"), path.join(dir, "segment.mp4"));
    await writeFile(manifest, "ffconcat version 1.0\nfile 'segment.mp4'\nduration 4\n");
    await assert.rejects(probeVideo(manifest));
    await assert.rejects(probeMedia(manifest));
    await assert.rejects(createMezzanine(manifest, path.join(dir, "out.mp4"), 5));
    assert.ok((await probeVideo(path.resolve("public/samples/shot-1.mp4"))).duration > 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
