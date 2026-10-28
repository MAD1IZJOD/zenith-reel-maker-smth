import "../../scripts/isolated-data";
import test from "node:test";
import assert from "node:assert/strict";
import { readJsonBody } from "@/lib/server/request-body";
import { HttpError } from "@/lib/server/security";
import { POST as createJob } from "@/app/api/jobs/route";

const status = (code: number) => (error: unknown) => error instanceof HttpError && error.status === code;
const request = (body: string) => new Request("http://localhost/api/jobs", { method: "POST", body });

test("JSON limits apply before parsing with absent or lying Content-Length", async () => {
  assert.deepEqual(await readJsonBody(request('{"title":"hello"}')), { title: "hello" });
  for (const length of [undefined, "1", "999999"]) {
    const headers: Record<string, string> = length === undefined ? {} : { "Content-Length": length };
    const r = new Request("http://localhost", { method: "POST", headers, body: JSON.stringify({ text: "a".repeat(1024) }) });
    await assert.rejects(readJsonBody(r, 128), status(413));
  }
  await assert.rejects(readJsonBody(request('{"text":"😀😀😀"}'), 20), status(413), "limits count UTF-8 bytes");
  for (const input of ["null", "[]", '"string"', "{} invalid"]) await assert.rejects(readJsonBody(request(input)), status(400));
});

test("slow and oversized streams are cancelled", async () => {
  let cancelled = 0;
  const slow = new ReadableStream<Uint8Array>({ cancel() { cancelled++; } });
  await assert.rejects(readJsonBody(new Request("http://localhost", { method: "POST", body: slow, duplex: "half" } as RequestInit), 128, 25), status(408));
  assert.equal(cancelled, 1);
  const chunks = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array(100)); }, cancel() { cancelled++; } });
  await assert.rejects(readJsonBody(new Request("http://localhost", { method: "POST", body: chunks, duplex: "half" } as RequestInit), 128), status(413));
  assert.equal(cancelled, 2);
});

test("unauthenticated oversized job requests return 413 rather than parsing the entire payload", async () => {
  const response = await createJob(request(JSON.stringify({ creative: Array(100_000).fill(null) })));
  assert.equal(response.status, 413);
});
