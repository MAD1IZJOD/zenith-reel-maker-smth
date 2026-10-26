import "../../scripts/isolated-data";
import test from "node:test";
import assert from "node:assert/strict";
import { EnhancementError, HiggsfieldProvider, higgsfieldConfig } from "@/lib/providers/higgsfield";

type Call = { url: string; init: RequestInit };
function fakeFetch(responses: Record<string, { status?: number; body: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const key = Object.keys(responses).find((path) => url.endsWith(path));
    const reply = key ? responses[key] : { status: 404, body: {} };
    return new Response(JSON.stringify(reply.body), { status: reply.status || 200, headers: reply.headers });
  }) as typeof fetch;
  return { fetcher, calls };
}
const configured = { keyId: "id-123", keySecret: "secret-456", enabled: true, baseUrl: "https://api.higgsfield.test" };
const request = { videoUrl: "https://cdn.example.org/reel.mp4", prompt: "Turn the sky into a warm sunset", duration: 8 };

test("capabilities reflect the documented model limits and configuration without exposing secrets", () => {
  const capabilities = new HiggsfieldProvider(higgsfieldConfig({})).capabilities();
  assert.equal(capabilities.configured, false); assert.equal(capabilities.enabled, false); assert.equal(capabilities.billable, true);
  assert.deepEqual(capabilities.durationSeconds, [3, 30]); assert.equal(capabilities.maxSourceSeconds, 30);
  assert.ok(!JSON.stringify(new HiggsfieldProvider(configured).capabilities()).includes("secret-456"));
});

test("estimate, submit, status, cancel and output follow the documented request shapes", async () => {
  const { fetcher, calls } = fakeFetch({
    "/estimate/kling-video/v4.0/video-edit": { body: { usd: "0.42" } },
    "/kling-video/v4.0/video-edit": { body: { request_id: "req_abc123", status: "queued", status_url: "x", cancel_url: "y" } },
    "/requests/req_abc123/status": { body: { request_id: "req_abc123", status: "completed", video: { url: "https://cdn.higgsfield.test/out.mp4" } } },
    "/requests/req_abc123/cancel": { body: {} },
  });
  const provider = new HiggsfieldProvider(configured, fetcher);
  assert.deepEqual(await provider.estimateCost(request), { usd: 0.42 });
  const submitted = await provider.submitEdit(request, { authorizedSpend: true, estimateUsd: 0.42 });
  assert.deepEqual(submitted, { requestId: "req_abc123", status: "queued", videoUrl: undefined });
  assert.deepEqual(JSON.parse(String(calls[1].init.body)), { prompt: "Turn the sky into a warm sunset", video_url: "https://cdn.example.org/reel.mp4", duration: 8, resolution: "720p", aspect_ratio: "9:16" });
  assert.equal((calls[1].init.headers as Record<string, string>).Authorization, "Key id-123:secret-456");
  assert.deepEqual(await provider.retrieveOutput("req_abc123"), { videoUrl: "https://cdn.higgsfield.test/out.mp4" });
  await provider.cancel("req_abc123");
  assert.ok(calls.at(-1)!.url.endsWith("/requests/req_abc123/cancel"));
});

test("billable work is refused unless enabled, configured and explicitly authorized", async () => {
  const { fetcher, calls } = fakeFetch({});
  await assert.rejects(new HiggsfieldProvider({ ...configured, enabled: false }, fetcher).submitEdit(request, { authorizedSpend: true, estimateUsd: 1 }), (error: EnhancementError) => error.kind === "disabled");
  await assert.rejects(new HiggsfieldProvider({ ...configured, keySecret: undefined }, fetcher).submitEdit(request, { authorizedSpend: true, estimateUsd: 1 }), (error: EnhancementError) => error.kind === "not-configured");
  await assert.rejects(new HiggsfieldProvider(configured, fetcher).submitEdit(request, {} as never), /spend authorization/);
  await assert.rejects(new HiggsfieldProvider(configured, fetcher).uploadVideo("x.mp4", {} as never), /consent/);
  assert.equal(calls.length, 0, "no network call was attempted");
});

test("invalid inputs, ids and upstream failures are handled without leaking details", async () => {
  const provider = new HiggsfieldProvider(configured, fakeFetch({ "/kling-video/v4.0/video-edit": { status: 500, body: { error: "secret-456 internal" } }, "/requests/req_busy1/status": { status: 429, body: {}, headers: { "retry-after": "12" } } }).fetcher);
  await assert.rejects(provider.submitEdit({ ...request, duration: 45 }, { authorizedSpend: true, estimateUsd: 1 }), (error: EnhancementError) => error.kind === "invalid");
  await assert.rejects(provider.submitEdit({ ...request, videoUrl: "http://insecure.example/a.mp4" }, { authorizedSpend: true, estimateUsd: 1 }), /https/);
  await assert.rejects(provider.getStatus("../../admin"), /Invalid request id/);
  await assert.rejects(provider.submitEdit(request, { authorizedSpend: true, estimateUsd: 1 }), (error: Error) => !error.message.includes("secret-456") && /HTTP 500/.test(error.message));
  await assert.rejects(provider.getStatus("req_busy1"), (error: EnhancementError) => error.kind === "rate-limited" && error.retryAfterSeconds === 12);
});
