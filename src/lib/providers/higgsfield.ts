import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { z } from "zod";

/**
 * Optional generative video enhancement through the Higgsfield API (Kling 4.0 video edit), per the official docs:
 * https://open.higgsfield.ai/models/kling-video/v4.0/video-edit/api-reference and https://docs.higgsfield.ai.
 * The normal FFmpeg pipeline never waits on this provider. Every billable call requires ENABLE_HIGGSFIELD=true,
 * server-side credentials and an explicit per-call spend authorization; visitor footage is only uploaded with consent.
 */
export interface VideoEnhancementProvider {
  capabilities(): EnhancementCapabilities;
  estimateCost(request: EditRequest): Promise<{ usd: number }>;
  submitEdit(request: EditRequest, authorization: SpendAuthorization): Promise<EnhancementStatus>;
  getStatus(requestId: string): Promise<EnhancementStatus>;
  cancel(requestId: string): Promise<void>;
  retrieveOutput(requestId: string): Promise<{ videoUrl: string }>;
}

export type EnhancementCapabilities = { provider: "higgsfield"; model: string; configured: boolean; enabled: boolean; billable: true; asynchronous: true; durationSeconds: [number, number]; maxSourceSeconds: number; resolutions: string[]; aspectRatios: string[]; outputRetentionDays: number };
export type EnhancementStatus = { requestId: string; status: "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled"; videoUrl?: string };
export type SpendAuthorization = { authorizedSpend: true; estimateUsd: number };
export class EnhancementError extends Error { constructor(public kind: "disabled" | "not-configured" | "invalid" | "rate-limited" | "http", message: string, public retryAfterSeconds?: number) { super(message); } }

const MODEL = "kling-video/v4.0/video-edit";
export const editRequestSchema = z.object({
  videoUrl: z.string().url().refine((value) => value.startsWith("https://"), "Source must be an https URL."),
  prompt: z.string().transform((value) => value.replace(/[\u0000-\u001f\u007f]/g, " ").trim()).pipe(z.string().min(3).max(1500)),
  duration: z.number().int().min(3).max(30).default(10),
  resolution: z.enum(["720p", "1080p"]).default("720p"),
  aspectRatio: z.enum(["9:16", "16:9", "1:1", "21:9", "adaptive"]).default("9:16"),
});
export type EditRequest = z.input<typeof editRequestSchema>;
const statusSchema = z.object({ request_id: z.string(), status: z.enum(["queued", "in_progress", "completed", "failed", "nsfw", "canceled"]), video: z.object({ url: z.string().url() }).optional() });
const REQUEST_ID = /^[A-Za-z0-9_-]{6,100}$/;

type Config = { keyId?: string; keySecret?: string; enabled: boolean; baseUrl: string };
export function higgsfieldConfig(env: Record<string, string | undefined> = process.env): Config {
  return { keyId: env.HIGGSFIELD_KEY_ID || undefined, keySecret: env.HIGGSFIELD_KEY_SECRET || undefined, enabled: env.ENABLE_HIGGSFIELD === "true", baseUrl: (env.HIGGSFIELD_BASE_URL || "https://api.higgsfield.ai").replace(/\/+$/, "") };
}

export class HiggsfieldProvider implements VideoEnhancementProvider {
  constructor(private config: Config = higgsfieldConfig(), private fetcher: typeof fetch = fetch) {}

  capabilities(): EnhancementCapabilities {
    return { provider: "higgsfield", model: MODEL, configured: Boolean(this.config.keyId && this.config.keySecret), enabled: this.config.enabled, billable: true, asynchronous: true, durationSeconds: [3, 30], maxSourceSeconds: 30, resolutions: ["720p", "1080p"], aspectRatios: ["9:16", "16:9", "1:1", "21:9", "adaptive"], outputRetentionDays: 7 };
  }

  private async call(path: string, init: RequestInit = {}): Promise<unknown> {
    if (!this.config.keyId || !this.config.keySecret) throw new EnhancementError("not-configured", "Higgsfield API credentials are not configured.");
    const response = await this.fetcher(`${this.config.baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(30_000), headers: { Authorization: `Key ${this.config.keyId}:${this.config.keySecret}`, "Content-Type": "application/json", ...(init.headers || {}) } });
    const text = await response.text();
    if (response.status === 429 || response.status === 503) throw new EnhancementError("rate-limited", "Higgsfield is at capacity for this account; retry later.", Number(response.headers.get("retry-after")) || 30);
    // Upstream messages are not echoed: they could reflect request details. Status codes are enough to act on.
    if (!response.ok) throw new EnhancementError("http", `Higgsfield request failed with HTTP ${response.status}.`);
    try { return text ? JSON.parse(text) : {}; } catch { throw new EnhancementError("http", "Higgsfield returned malformed JSON."); }
  }

  private body(request: EditRequest) {
    const parsed = editRequestSchema.safeParse(request);
    if (!parsed.success) throw new EnhancementError("invalid", parsed.error.issues[0]?.message || "Invalid edit request.");
    const value = parsed.data;
    return { prompt: value.prompt, video_url: value.videoUrl, duration: value.duration, resolution: value.resolution, aspect_ratio: value.aspectRatio };
  }

  /** The documented estimate endpoint mirrors the model path; it does not start a generation. */
  async estimateCost(request: EditRequest): Promise<{ usd: number }> {
    const result = await this.call(`/estimate/${MODEL}`, { method: "POST", body: JSON.stringify(this.body(request)) }) as { usd?: string | number };
    const usd = Number(result.usd);
    if (!Number.isFinite(usd) || usd < 0) throw new EnhancementError("http", "Higgsfield did not return a cost estimate.");
    return { usd };
  }

  async submitEdit(request: EditRequest, authorization: SpendAuthorization): Promise<EnhancementStatus> {
    if (!this.config.enabled) throw new EnhancementError("disabled", "Generative enhancement is disabled (set ENABLE_HIGGSFIELD=true to allow billable requests).");
    if (authorization?.authorizedSpend !== true || !Number.isFinite(authorization.estimateUsd)) throw new EnhancementError("invalid", "A billable request needs an explicit spend authorization with its estimate.");
    return this.normalize(await this.call(`/${MODEL}`, { method: "POST", body: JSON.stringify(this.body(request)) }));
  }

  async getStatus(requestId: string): Promise<EnhancementStatus> { return this.normalize(await this.call(`/requests/${this.id(requestId)}/status`, { method: "GET" })); }
  /** Stopping polling does not stop generation; the documented cancel endpoint must be called. */
  async cancel(requestId: string): Promise<void> { await this.call(`/requests/${this.id(requestId)}/cancel`, { method: "POST" }); }
  async retrieveOutput(requestId: string): Promise<{ videoUrl: string }> {
    const status = await this.getStatus(requestId);
    if (status.status !== "completed" || !status.videoUrl) throw new EnhancementError("invalid", `Output is not available (status: ${status.status}).`);
    return { videoUrl: status.videoUrl };
  }

  /** Uploads an MP4 through a presigned URL. API credentials are never sent to the storage URL. */
  async uploadVideo(file: string, consent: { visitorConsented: true }): Promise<string> {
    if (consent?.visitorConsented !== true) throw new EnhancementError("invalid", "Footage leaves this computer only with the visitor's explicit consent.");
    const target = await this.call("/files/generate-upload-url", { method: "POST", body: JSON.stringify({ content_type: "video/mp4" }) }) as { upload_url?: string; public_url?: string; upload_headers?: Record<string, string> };
    if (!target.upload_url?.startsWith("https://") || !target.public_url?.startsWith("https://")) throw new EnhancementError("http", "Higgsfield did not return an upload location.");
    const { size } = await stat(file);
    const response = await this.fetcher(target.upload_url, { method: "PUT", headers: { ...(target.upload_headers || {}), "Content-Length": String(size) }, body: Readable.toWeb(createReadStream(file)) as ReadableStream, duplex: "half", signal: AbortSignal.timeout(10 * 60_000) } as RequestInit);
    if (!response.ok) throw new EnhancementError("http", `Upload failed with HTTP ${response.status}.`);
    return target.public_url;
  }

  private id(requestId: string) { if (!REQUEST_ID.test(requestId)) throw new EnhancementError("invalid", "Invalid request id."); return requestId; }
  private normalize(value: unknown): EnhancementStatus {
    const parsed = statusSchema.safeParse(value);
    if (!parsed.success) throw new EnhancementError("http", "Unexpected Higgsfield response.");
    return { requestId: parsed.data.request_id, status: parsed.data.status, videoUrl: parsed.data.video?.url };
  }
}
