import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Server-side local language model access. Visitors never reach the model endpoint: every call goes through
 * an API route that validates the result against a strict schema before anything touches the edit.
 */
export type ProviderRuntime = "ollama" | "openai-compatible";
export type ProviderHealth = { available: boolean; runtime?: ProviderRuntime; model?: string; reason?: string; checkedAt: number; latencyMs?: number };
export type ProviderCapabilities = { structuredOutput: boolean; vision: false; maxContextTokens: number };
export class ProviderError extends Error { constructor(public kind: "unavailable" | "timeout" | "invalid-output" | "http", message: string) { super(message); } }

type Message = { role: "system" | "user"; content: string };
export type StructuredRequest<T> = { name: string; schema: z.ZodType<T>; jsonSchema: Record<string, unknown>; messages: Message[]; maxTokens?: number; temperature?: number; timeoutMs?: number };

export type ProviderConfig = { mode: "auto" | "ollama" | "openai" | "off"; url: string; model: string; timeoutMs: number; contextTokens: number };
export function providerConfig(env: Record<string, string | undefined> = process.env): ProviderConfig {
  const mode = env.CREATIVE_MODEL_PROVIDER === "ollama" || env.CREATIVE_MODEL_PROVIDER === "openai" || env.CREATIVE_MODEL_PROVIDER === "off" ? env.CREATIVE_MODEL_PROVIDER : "auto";
  const timeout = Number(env.CREATIVE_MODEL_TIMEOUT_MS);
  return {
    mode, url: (env.CREATIVE_MODEL_URL || (mode === "openai" ? "http://127.0.0.1:1234" : "http://127.0.0.1:11434")).replace(/\/+$/, ""),
    model: env.CREATIVE_MODEL || "auto", timeoutMs: Number.isFinite(timeout) && timeout >= 1000 && timeout <= 120_000 ? timeout : 25_000, contextTokens: 4096,
  };
}

/** Strips reasoning blocks and code fences some local runtimes add despite structured-output requests. */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new ProviderError("invalid-output", "Model reply contained no JSON object.");
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { throw new ProviderError("invalid-output", "Model reply was not valid JSON."); }
}

async function request(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  let response: Response;
  try { response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), headers: { "Content-Type": "application/json", ...(init.headers || {}) } }); }
  catch (error) { throw (error as Error).name === "TimeoutError" ? new ProviderError("timeout", `Model did not answer within ${Math.round(timeoutMs / 1000)}s.`) : new ProviderError("unavailable", "Local model service is not reachable."); }
  const body = await response.text();
  if (!response.ok) {
    // Ollama reports load failures (for example out-of-memory) as JSON errors; keep only a short, path-free reason.
    const reason = (() => { try { return String((JSON.parse(body) as { error?: string }).error || "").slice(0, 160); } catch { return ""; } })();
    if (/memory|alloc/i.test(reason)) throw new ProviderError("unavailable", "The local model could not load: not enough free memory (bad_alloc). Close other applications or use a smaller model.");
    throw new ProviderError("http", reason ? `Model runtime error: ${reason.replace(/[A-Za-z]:\\[^\s]+/g, "").replace(/\s+/g, " ").slice(0, 120)}` : `Model runtime returned HTTP ${response.status}.`);
  }
  try { return JSON.parse(body); } catch { throw new ProviderError("invalid-output", "Model runtime returned malformed JSON."); }
}

// One generation at a time: a second concurrent 8B inference would only thrash memory on this class of laptop.
let queue: Promise<unknown> = Promise.resolve();
function singleFlight<T>(task: () => Promise<T>): Promise<T> { const next = queue.catch(() => undefined).then(task); queue = next; return next; }
const cache = new Map<string, unknown>();
const remember = (key: string, value: unknown) => { cache.set(key, value); if (cache.size > 64) cache.delete(cache.keys().next().value as string); };

export class LocalModelProvider {
  private healthCache?: ProviderHealth;
  private resolved?: { runtime: ProviderRuntime; model: string };
  constructor(private config: ProviderConfig = providerConfig()) {}

  getCapabilities(): ProviderCapabilities { return { structuredOutput: true, vision: false, maxContextTokens: this.config.contextTokens }; }

  /** Discovers the runtime and a Qwen model from the configured endpoint. Cached for 30 seconds. */
  async health(force = false): Promise<ProviderHealth> {
    if (!force && this.healthCache && Date.now() - this.healthCache.checkedAt < 30_000) return this.healthCache;
    const started = Date.now();
    const done = (value: Omit<ProviderHealth, "checkedAt">) => (this.healthCache = { ...value, checkedAt: Date.now(), latencyMs: Date.now() - started });
    if (this.config.mode === "off") return done({ available: false, reason: "Disabled by configuration." });
    const pick = (names: string[]) => (this.config.model !== "auto" ? names.find((name) => name === this.config.model) : names.find((name) => /^qwen3/i.test(name)) || names.find((name) => /qwen/i.test(name)));
    if (this.config.mode === "auto" || this.config.mode === "ollama") {
      try {
        const tags = await request(`${this.config.url}/api/tags`, { method: "GET" }, 3000) as { models?: { name: string }[] };
        const model = pick((tags.models || []).map((item) => item.name));
        if (model) { this.resolved = { runtime: "ollama", model }; return done({ available: true, runtime: "ollama", model }); }
        if (this.config.mode === "ollama") return done({ available: false, runtime: "ollama", reason: "No Qwen model is installed in Ollama." });
      } catch (error) { if (this.config.mode === "ollama") return done({ available: false, runtime: "ollama", reason: (error as Error).message }); }
    }
    try {
      const models = await request(`${this.config.url}/v1/models`, { method: "GET" }, 3000) as { data?: { id: string }[] };
      const model = pick((models.data || []).map((item) => item.id));
      if (model) { this.resolved = { runtime: "openai-compatible", model }; return done({ available: true, runtime: "openai-compatible", model }); }
      return done({ available: false, runtime: "openai-compatible", reason: "No Qwen model is served at the configured endpoint." });
    } catch (error) { return done({ available: false, reason: (error as Error).message }); }
  }

  /** Concise, schema-constrained JSON. Reasoning is disabled; results are validated and cached by request. */
  async structured<T>(input: StructuredRequest<T>): Promise<{ value: T; latencyMs: number; model: string; cached: boolean }> {
    const health = await this.health();
    if (!health.available || !this.resolved) throw new ProviderError("unavailable", health.reason || "No local model available.");
    const { runtime, model } = this.resolved;
    const key = createHash("sha256").update(JSON.stringify([this.config.url, runtime, model, input.name, input.messages, input.temperature])).digest("hex");
    if (cache.has(key)) return { value: input.schema.parse(cache.get(key)), latencyMs: 0, model, cached: true };
    return singleFlight(async () => {
      const started = Date.now();
      const timeout = input.timeoutMs ?? this.config.timeoutMs;
      const temperature = input.temperature ?? 0.4, maxTokens = input.maxTokens ?? 400;
      let text: string;
      if (runtime === "ollama") {
        const reply = await request(`${this.config.url}/api/chat`, { method: "POST", body: JSON.stringify({ model, messages: input.messages, stream: false, think: false, format: input.jsonSchema, keep_alive: "10m", options: { temperature, num_ctx: this.config.contextTokens, num_predict: maxTokens } }) }, timeout) as { message?: { content?: string } };
        text = reply.message?.content || "";
      } else {
        const reply = await request(`${this.config.url}/v1/chat/completions`, { method: "POST", body: JSON.stringify({ model, messages: input.messages, temperature, max_tokens: maxTokens, response_format: { type: "json_schema", json_schema: { name: input.name, schema: input.jsonSchema, strict: true } } }) }, timeout) as { choices?: { message?: { content?: string } }[] };
        text = reply.choices?.[0]?.message?.content || "";
      }
      if (text.length > 8000) throw new ProviderError("invalid-output", "Model reply exceeded the size limit.");
      const parsed = input.schema.safeParse(extractJson(text));
      if (!parsed.success) throw new ProviderError("invalid-output", `Model reply failed validation: ${parsed.error.issues[0]?.message || "schema mismatch"}.`);
      remember(key, parsed.data);
      return { value: parsed.data, latencyMs: Date.now() - started, model, cached: false };
    });
  }
}

const globalProvider = globalThis as typeof globalThis & { zenithModelProvider?: LocalModelProvider };
export const creativeModel = () => (globalProvider.zenithModelProvider ||= new LocalModelProvider());
