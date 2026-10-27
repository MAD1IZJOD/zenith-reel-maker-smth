import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

test("private creator registration, render gate, CSV safety and retention", async () => {
  const previous = process.env.DATA_DIR;
  const previousSecret = process.env.OPERATOR_SECRET;
  process.env.OPERATOR_SECRET = randomUUID() + randomUUID();
  const directory = await mkdtemp(path.join(os.tmpdir(), "zenith-registration-"));
  process.env.DATA_DIR = directory;
  try {
    const { issueSession, sessionCookie } = await import("../../src/lib/server/security");
    const { GET, PUT } = await import("../../src/app/api/sessions/[sessionId]/registration/route");
    const { POST: generate } = await import("../../src/app/api/jobs/route");
    const { GET: exportCsv } = await import("../../src/app/api/operator/registrations/route");
    const { getRegistration, registrationCsv, requireRegistration } = await import("../../src/lib/server/registrations");
    const { recordPath, writeJson } = await import("../../src/lib/server/store");
    const { issueOperatorCookie } = await import("../../src/lib/server/operator");
    const { cleanupExpiredSessions } = await import("../../src/lib/storage/session-storage");
    const id = randomUUID(); const { token } = await issueSession(id);
    const cookie = `${sessionCookie(id)}=${token}`;
    const context = { params: Promise.resolve({ sessionId: id }) };
    const request = (method = "GET", body?: unknown, credential = cookie) => new Request(`http://localhost/api/sessions/${id}/registration`, { method, headers: { cookie: credential, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.equal((await GET(request("GET", undefined, ""), context)).status, 401);
    assert.equal((await PUT(request("PUT", { name: "Visitor", email: "visitor@example.com", acknowledged: true }, ""), context)).status, 401);
    assert.equal((await (await GET(request(), context)).json()).registered, false);
    assert.equal((await generate(new Request("http://localhost/api/jobs", { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: id, presetId: "main-character" }) }))).status, 428);
    for (const input of [{ name: " ", email: "visitor@example.com", acknowledged: true }, { name: "Visitor", email: "bad", acknowledged: true }, { name: "Visitor", email: "visitor@example.com", acknowledged: false }, { name: "Visitor", email: "visitor@example.com" }]) {
      assert.equal((await PUT(request("PUT", input), context)).status, 400);
    }
    const details = { name: ' =HYPERLINK("test") ', email: " VISITOR@example.com ", acknowledged: true };
    assert.equal((await PUT(request("PUT", details), context)).status, 200);
    const record = await getRegistration(id); assert.ok(record);
    assert.equal(record.email, "visitor@example.com");
    assert.equal(record.expiresAt - record.createdAt, 30 * 86_400_000);
    await requireRegistration(id);
    const status = await GET(request(), context);
    assert.equal(status.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await status.json(), { registered: true, retentionDays: 30 });
    assert.equal((await PUT(request("PUT", details), context)).status, 200);
    assert.equal((await getRegistration(id))?.createdAt, record.createdAt);
    const csv = await registrationCsv();
    assert.match(csv, /'\=HYPERLINK\(""test""\)/);
    assert.equal(csv.split("visitor@example.com").length - 1, 1, "retries do not duplicate contacts");
    assert.ok(!csv.includes(token), "CSV never contains browser credentials");
    assert.equal((await exportCsv(new Request("http://localhost/api/operator/registrations"))).status, 401);
    const exported = await exportCsv(new Request("http://localhost/api/operator/registrations", { headers: { cookie: `srs-operator=${issueOperatorCookie()}` } }));
    assert.equal(exported.status, 200);
    assert.equal(exported.headers.get("Cache-Control"), "no-store");
    assert.equal(Buffer.from(await exported.arrayBuffer()).toString("utf8"), csv);
    await writeJson(recordPath("registrations", id), { ...record, expiresAt: Date.now() - 1 });
    assert.equal(await getRegistration(id), undefined);
    await assert.rejects(requireRegistration(id));
    assert.ok(!(await registrationCsv()).includes("visitor@example.com"));
    await cleanupExpiredSessions();
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous;
    if (previousSecret === undefined) delete process.env.OPERATOR_SECRET; else process.env.OPERATOR_SECRET = previousSecret;
    await rm(directory, { recursive: true, force: true });
  }
});
