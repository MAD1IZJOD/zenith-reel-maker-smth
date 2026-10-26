import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { assertSessionId } from "@/lib/storage/session-storage";
import { recordPath, readJson, writeJson } from "./store";
import { retentionMs } from "./config";

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export const secretToken = () => randomBytes(32).toString("hex");
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export function equalSecret(left: string, right: string): boolean { return timingSafeEqual(Buffer.from(digest(left)), Buffer.from(digest(right))); }
export function cookie(request: Request, name: string): string {
  return request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) || "";
}
export const secureCookies = () => process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false";
export const sessionCookie = (id: string) => `srs-${id}`;
export type SessionAccess = { id: string; secretHash: string; createdAt: number; expiresAt: number };
export async function issueSession(id: string) {
  assertSessionId(id);
  const token = secretToken();
  const access: SessionAccess = { id, secretHash: digest(token), createdAt: Date.now(), expiresAt: Date.now() + retentionMs() };
  await writeJson(recordPath("access", id), access);
  return { access, token };
}
export async function requireSession(request: Request, id: string): Promise<SessionAccess> {
  try { assertSessionId(id); } catch { throw new HttpError(401, "This session is unavailable. Start a new reel."); }
  const access = await readJson<SessionAccess>(recordPath("access", id));
  const provided = cookie(request, sessionCookie(id));
  if (!access || access.expiresAt <= Date.now() || !provided || !equalSecret(digest(provided), access.secretHash)) throw new HttpError(401, "Session access expired or belongs to another browser. Start a new reel.");
  return access;
}
export function errorResponse(error: unknown, fallback = "Request failed.") {
  return NextResponse.json({ error: error instanceof HttpError ? error.message : fallback }, { status: error instanceof HttpError ? error.status : 400, headers: { "Cache-Control": "no-store" } });
}
type Bucket = { count: number; until: number };
const global = globalThis as typeof globalThis & { studioLimits?: Map<string, Bucket> };
const buckets = global.studioLimits ||= new Map();
export function rateLimit(key: string, max: number, interval = 60_000) {
  const now = Date.now();
  for (const [id, bucket] of buckets) if (bucket.until < now) buckets.delete(id);
  const bucket = buckets.get(key) || { count: 0, until: now + interval };
  if (++bucket.count > max) throw new HttpError(429, "Too many requests. Please wait a minute and try again.");
  buckets.set(key, bucket);
}
export function networkKey(request: Request): string {
  // Only trust forwarding headers behind the documented, exclusively exposed reverse proxy. Cloudflare Tunnel sets
  // CF-Connecting-IP itself, whereas a client can prepend its own X-Forwarded-For entries.
  if (process.env.TRUST_PROXY === "cloudflare") return request.headers.get("cf-connecting-ip")?.trim() || "unknown";
  return process.env.TRUST_PROXY === "true" ? request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown" : "local";
}
