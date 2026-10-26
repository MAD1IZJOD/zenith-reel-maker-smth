import "../../scripts/isolated-data";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { LocalModelProvider, extractJson, providerConfig } from "@/lib/ai/provider";
import { planCreative, rulesPlan, observe } from "@/lib/ai/creative-planner";
import { getPreset } from "@/lib/presets";

type Behaviour = "valid" | "think" | "invalid-json" | "bad-enum" | "slow" | "oom" | "openai";
const valid = { hook: "Wait For It", hookAlternatives: ["One Crew", "The Reveal"], shotOrder: [2, 1, 3], pacing: "punchy", transitionStyle: "energetic", grade: "cool-cinematic", captionStyle: "high-energy", captions: ["Arrive", "Look", "Reveal"], rationale: "Strongest motion opens." };

async function mockRuntime(behaviour: Behaviour) {
  let active = 0, peak = 0, calls = 0;
  const server = http.createServer(async (request, response) => {
    const send = (status: number, body: unknown) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(body)); };
    if (request.url === "/api/tags") return behaviour === "openai" ? send(404, { error: "not found" }) : send(200, { models: [{ name: "nomic-embed-text:latest" }, { name: "qwen3:8b" }] });
    if (request.url === "/v1/models") return send(200, { data: [{ id: "qwen3-8b-instruct" }] });
    calls++; active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, behaviour === "slow" ? 1500 : 60));
    active--;
    if (behaviour === "oom") return send(500, { error: "llama-server process has terminated: error loading model: std::bad_alloc" });
    const content = behaviour === "think" ? `<think>reasoning</think>\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\`` : behaviour === "invalid-json" ? "{hook: nope" : JSON.stringify(behaviour === "bad-enum" ? { ...valid, grade: "neon; drop" } : valid);
    if (request.url === "/v1/chat/completions") return send(200, { choices: [{ message: { content } }] });
    return send(200, { message: { content } });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, close: () => new Promise<void>((resolve) => server.close(() => resolve())), stats: () => ({ peak, calls }) };
}
const provider = (url: string, timeoutMs = 1000) => new LocalModelProvider({ ...providerConfig({}), url, timeoutMs });
const preset = getPreset("movie-trailer")!;
const analyses = [{ supported: true, technicalValidity: "valid" as const, duration: 4, width: 1080, height: 1920, orientation: "portrait" as const, hasAudio: false, sampledFrames: 3, brightness: 0.5, issues: [], activity: { step: 0.2, motion: [0, 1, 1, 1], audio: [] } }, undefined, undefined];

test("discovers a Qwen model from Ollama or an OpenAI-compatible server", async () => {
  const ollama = await mockRuntime("valid");
  try { assert.deepEqual((({ available, runtime, model }) => ({ available, runtime, model }))(await provider(ollama.url).health()), { available: true, runtime: "ollama", model: "qwen3:8b" }); } finally { await ollama.close(); }
  const openai = await mockRuntime("openai");
  try {
    const health = await provider(openai.url).health();
    assert.equal(health.runtime, "openai-compatible"); assert.equal(health.model, "qwen3-8b-instruct");
    const plan = await planCreative(preset, "dramatic", analyses, undefined, provider(openai.url));
    assert.equal(plan.source, "qwen");
  } finally { await openai.close(); }
});

test("valid structured output becomes a bounded plan patch", async () => {
  for (const behaviour of ["valid", "think"] as const) {
    const runtime = await mockRuntime(behaviour);
    try {
      const plan = await planCreative(preset, "dramatic", analyses, undefined, provider(runtime.url));
      assert.equal(plan.source, "qwen"); assert.equal(plan.model, "qwen3:8b");
      assert.deepEqual(plan.patch.shotOrder, [1, 0, 2]);
      assert.equal(plan.patch.grade, "cool-cinematic"); assert.equal(plan.patch.planSource, "qwen");
      assert.ok(plan.hookOptions.length >= 2);
    } finally { await runtime.close(); }
  }
});

test("invalid, unsafe, slow, out-of-memory and unreachable models fall back to rules", async () => {
  for (const behaviour of ["invalid-json", "bad-enum", "slow", "oom"] as const) {
    const runtime = await mockRuntime(behaviour);
    try {
      const plan = await planCreative(preset, "dramatic", analyses, undefined, provider(runtime.url));
      assert.equal(plan.source, "rules", behaviour); assert.ok(plan.fallbackReason, behaviour);
      if (behaviour === "slow") assert.match(plan.fallbackReason!, /did not answer/);
      if (behaviour === "oom") assert.match(plan.fallbackReason!, /bad_alloc/);
      assert.equal(plan.patch.planSource, "rules");
    } finally { await runtime.close(); }
  }
  const offline = await planCreative(preset, "dramatic", analyses, undefined, provider("http://127.0.0.1:9"));
  assert.equal(offline.source, "rules"); assert.match(offline.fallbackReason!, /not reachable/);
  const disabled = await new LocalModelProvider({ ...providerConfig({ CREATIVE_MODEL_PROVIDER: "off" }) }).health();
  assert.equal(disabled.available, false);
});

test("generations run one at a time and identical requests are cached", async () => {
  const runtime = await mockRuntime("valid");
  try {
    const client = provider(runtime.url);
    await Promise.all([planCreative(preset, "funny", analyses, undefined, client), planCreative(preset, "energetic", analyses, undefined, client), planCreative(preset, "aesthetic", analyses, undefined, client)]);
    assert.equal(runtime.stats().peak, 1);
    await planCreative(preset, "funny", analyses, undefined, client);
    assert.equal(runtime.stats().calls, 3);
  } finally { await runtime.close(); }
});

test("rules plan is deterministic and observations describe measured facts only", () => {
  const observations = observe(preset, analyses);
  assert.deepEqual(observations[0], { shot: 1, intent: preset.shots[0], seconds: 4, orientation: "portrait", light: "normal", motion: "low", speech: false });
  assert.equal(observations[1].motion, "unknown");
  assert.deepEqual(rulesPlan(preset, "energetic", observations), rulesPlan(preset, "energetic", observations));
  assert.throws(() => extractJson("no json here"));
});
