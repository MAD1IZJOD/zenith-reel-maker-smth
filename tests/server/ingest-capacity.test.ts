import "../../scripts/isolated-data";
import test from "node:test";
import assert from "node:assert/strict";
import { issueSession, sessionCookie } from "@/lib/server/security";
import { createSessionId, ensureSession } from "@/lib/storage/session-storage";
import { PUT } from "@/app/api/sources/upload/route";

test("simultaneous uploads reserve capacity before async record creation and release it on failure", { timeout: 10_000 }, async () => {
  const sessions = await Promise.all(Array.from({ length: 3 }, async () => {
    const id = createSessionId();
    const { token } = await issueSession(id); await ensureSession(id);
    return { id, cookie: `${sessionCookie(id)}=${token}` };
  }));
  const controls: ReadableStreamDefaultController<Uint8Array>[] = [];
  const requests = sessions.map(({ id, cookie }, index) => new Request(`http://localhost/api/sources/upload?sessionId=${id}&rights=confirmed`, {
    method: "PUT", headers: { Cookie: cookie, "Content-Type": "video/mp4" },
    body: new ReadableStream<Uint8Array>({ start(controller) { controls[index] = controller; } }), duplex: "half",
  } as RequestInit));
  const pending = requests.map((request) => PUT(request));
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const first = await Promise.race([...pending, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("capacity was not enforced before reading uploads")), 1500); })]);
    assert.equal(first.status, 429);
  } finally {
    clearTimeout(timeout);
    controls.forEach((controller) => controller.close());
    await Promise.all(pending);
  }
  const { id, cookie } = sessions[0];
  const retry = await PUT(new Request(`http://localhost/api/sources/upload?sessionId=${id}&rights=confirmed`, { method: "PUT", headers: { Cookie: cookie, "Content-Type": "video/mp4" }, body: new Uint8Array(), duplex: "half" } as RequestInit));
  assert.equal(retry.status, 400, "failed uploads released their slots");
});
