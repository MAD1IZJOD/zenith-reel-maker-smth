import test from "node:test";
import assert from "node:assert/strict";
import { cachedCheck } from "@/lib/server/health";

test("a burst of health requests shares one expensive check and caches failure too", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const check = cachedCheck(async () => { calls++; await gate; throw new Error("offline"); }, 30);
  const requests = Array.from({ length: 100 }, () => check());
  assert.equal(calls, 1);
  release();
  assert.ok((await Promise.all(requests)).every((ok) => ok === false));
  assert.equal(await check(), false);
  assert.equal(calls, 1);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(await check(), false);
  assert.equal(calls, 2);
});
