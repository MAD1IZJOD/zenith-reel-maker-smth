import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { copyFile, readFile } from "node:fs/promises";
import { POST } from "@/app/api/uploads/route";
import { issueSession, sessionCookie } from "@/lib/server/security";
import { createSessionId, ensureSession } from "@/lib/storage/session-storage";
import { ffmpeg, runProcess } from "@/lib/video/process";

test("upload route returns actionable duration errors without discarding existing shots", async () => {
  const id = createSessionId(); const { token } = await issueSession(id); const directory = await ensureSession(id);
  const source = path.join(directory, "too-long.mp4");
  const previousShot = path.join(directory, "shot-1.mp4");
  await copyFile(path.join(process.cwd(), "public", "samples", "shot-1.mp4"), previousShot);
  const original = await readFile(previousShot);
  await runProcess(ffmpeg(), ["-y", "-f", "lavfi", "-i", "color=c=blue:s=32x32:r=1:d=91", "-c:v", "libx264", "-pix_fmt", "yuv420p", source], "Duration-limit fixture");
  const form = new FormData(); form.set("sessionId", id); form.set("shot", "1"); form.set("file", new Blob([await readFile(source)], { type: "video/mp4" }), "too-long.mp4");
  const response = await POST(new Request("http://localhost/api/uploads", { method: "POST", headers: { Cookie: `${sessionCookie(id)}=${token}` }, body: form }));
  assert.equal(response.status, 400); assert.match((await response.json()).error, /0.5 to 90 seconds/);
  assert.deepEqual(await readFile(previousShot), original);
});
