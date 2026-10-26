import test from "node:test";
import assert from "node:assert/strict";
import { blockedForPublic, isLoopbackRequest } from "@/lib/server/local-only";

const on = { OPERATOR_LOCAL_ONLY: "true" };
const headers = (values: Record<string, string>) => new Headers(values);

test("operator and model diagnostics stay on the stall computer when OPERATOR_LOCAL_ONLY is set", () => {
  const local = headers({ host: "localhost:3000", "x-forwarded-for": "::1" });
  for (const path of ["/operator", "/operator/", "/api/operator", "/api/operator/login", "/api/ai/health"]) {
    assert.equal(blockedForPublic(path, local, on), false, path);
    assert.equal(blockedForPublic(path, headers({ host: "studio.example.org", "x-forwarded-for": "203.0.113.9" }), on), true, `${path} via public host`);
  }
  // A tunnel connects from loopback but carries the visitor's address; a spoofed Host must not pass either.
  assert.equal(isLoopbackRequest(headers({ host: "localhost", "cf-connecting-ip": "203.0.113.9" })), false);
  assert.equal(isLoopbackRequest(headers({ host: "127.0.0.1:3000", "x-forwarded-for": "198.51.100.4, 127.0.0.1" })), false);
  assert.equal(isLoopbackRequest(headers({ host: "10.24.26.116:3000", "x-forwarded-for": "10.24.26.50" })), false);
  assert.equal(isLoopbackRequest(headers({ host: "[::1]:3000" })), true);
});

test("visitor routes and the default configuration are never affected", () => {
  const remote = headers({ host: "studio.example.org", "cf-connecting-ip": "203.0.113.9" });
  for (const path of ["/", "/festival", "/display", "/api/sessions", "/api/jobs", "/operatorx", "/api/aid"]) assert.equal(blockedForPublic(path, remote, on), false, path);
  assert.equal(blockedForPublic("/operator", remote, {}), false);
});

test("the stall computer can act on localhost while visitors must use the public origin", async () => {
  const { crossOriginReason } = await import("@/lib/server/origin");
  const previous = process.env.PUBLIC_BASE_URL; process.env.PUBLIC_BASE_URL = "https://studio.example.org";
  try {
    assert.equal(crossOriginReason("POST", headers({ host: "localhost:3000", origin: "http://localhost:3000" }), "http://localhost:3000"), undefined);
    assert.equal(crossOriginReason("POST", headers({ host: "studio.example.org", origin: "https://studio.example.org", "cf-connecting-ip": "203.0.113.9" }), "https://studio.example.org"), undefined);
    assert.ok(crossOriginReason("POST", headers({ host: "localhost:3000", origin: "http://localhost:3000", "cf-connecting-ip": "203.0.113.9" }), "http://localhost:3000"));
    assert.ok(crossOriginReason("POST", headers({ host: "localhost:3000", origin: "https://evil.example" }), "http://localhost:3000"));
    assert.ok(crossOriginReason("POST", headers({ host: "10.24.26.116:3000", origin: "http://10.24.26.116:3000" }), "http://10.24.26.116:3000"));
  } finally { if (previous === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = previous; }
});
