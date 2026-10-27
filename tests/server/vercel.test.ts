import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function config(env: Record<string, string>) {
  return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", "const loaded = await import('./next.config.ts'); const config = loaded.default.default || loaded.default; console.log(JSON.stringify(await config.redirects()));"], {
    env: { ...process.env, ...env }, encoding: "utf8", windowsHide: true,
  });
}

test("local studio stays local even if a gateway origin is supplied", () => {
  const result = config({ VERCEL: "", STUDIO_ORIGIN: "https://studio.example.org" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), []);
});

test("Vercel preserves every path through a temporary redirect to the studio", () => {
  const result = config({ VERCEL: "1", STUDIO_ORIGIN: "https://studio.example.org/" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [{ source: "/:path*", destination: "https://studio.example.org/:path*", permanent: false }]);
});

test("Vercel refuses missing, insecure, credential-bearing, and looping origins", () => {
  for (const origin of ["", "http://studio.example.org", "https://user:password@studio.example.org", "https://studio.example.org/path", "https://studio.example.org?query=1", "https://studio.example.org/#hash", "https://studio.vercel.app"]) {
    const result = config({ VERCEL: "1", STUDIO_ORIGIN: origin });
    assert.notEqual(result.status, 0, origin);
    assert.match(result.stderr, /STUDIO_ORIGIN/);
  }
});

test("Vercel startup does not import or initialize filesystem workers", async () => {
  const previous = process.env.VERCEL;
  const runtime = process.env.NEXT_RUNTIME;
  process.env.VERCEL = "1";
  process.env.NEXT_RUNTIME = "nodejs";
  try {
    const { register } = await import("../../src/instrumentation");
    await register();
  } finally {
    if (previous === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous;
    if (runtime === undefined) delete process.env.NEXT_RUNTIME; else process.env.NEXT_RUNTIME = runtime;
  }
});
