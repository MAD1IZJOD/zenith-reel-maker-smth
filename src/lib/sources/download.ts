import http from "node:http";
import https from "node:https";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { assertPublicHost, parseMediaUrl, safeLookup, UnsafeUrlError } from "./url-safety";

export type DownloadLimits = { maxBytes: number; timeoutMs: number; maxRedirects?: number };
export type DownloadResult = { bytes: number; contentType: string; finalHost: string };
/** Safety hooks. Production always uses the defaults; tests substitute them to reach a local fixture server. */
export type DownloadGuards = { parse: typeof parseMediaUrl; assertHost: typeof assertPublicHost; lookup: typeof safeLookup };
const SAFE: DownloadGuards = { parse: parseMediaUrl, assertHost: assertPublicHost, lookup: safeLookup };
const MEDIA_TYPES = /^(video\/|audio\/|application\/(octet-stream|mp4|x-matroska|ogg)|binary\/octet-stream)/i;

/**
 * Streams a public media file to disk. Redirects are followed manually (each target re-validated), sizes are
 * enforced while streaming, the whole transfer has a deadline, and private addresses are refused at connect time.
 * Downloaded bytes are never trusted: callers must decode-validate the file before use.
 */
export async function downloadMedia(raw: string, target: string, limits: DownloadLimits, guards: DownloadGuards = SAFE): Promise<DownloadResult> {
  let url = guards.parse(raw);
  const deadline = Date.now() + limits.timeoutMs;
  for (let redirects = 0; ; redirects++) {
    await guards.assertHost(url);
    const result = await new Promise<{ redirect?: string; done?: DownloadResult }>((resolve, reject) => {
      const client = url.protocol === "https:" ? https : http;
      const request = client.get(url, { lookup: guards.lookup as never, headers: { "User-Agent": "ZenithReelMaker/1.0 (+media import)", Accept: "video/*,audio/*;q=0.9,*/*;q=0.1" }, timeout: Math.max(1000, deadline - Date.now()) }, (response) => {
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400 && response.headers.location) { response.resume(); return resolve({ redirect: new URL(response.headers.location, url).toString() }); }
        if (status !== 200) { response.resume(); return reject(new UnsafeUrlError(`The media server answered ${status}. Check that the link opens the file directly.`)); }
        const contentType = String(response.headers["content-type"] || "application/octet-stream").split(";")[0].trim();
        if (!MEDIA_TYPES.test(contentType)) { response.resume(); return reject(new UnsafeUrlError("This link is a web page, not a media file. Use a direct link to an MP4, MOV, WebM, MP3, M4A or WAV file.")); }
        const declared = Number(response.headers["content-length"]);
        if (Number.isFinite(declared) && declared > limits.maxBytes) { response.resume(); return reject(new UnsafeUrlError(`This file is larger than the ${Math.round(limits.maxBytes / 1048576)} MB limit.`)); }
        let bytes = 0;
        const file = createWriteStream(target, { mode: 0o600 });
        const timer = setTimeout(() => response.destroy(new UnsafeUrlError("The download took too long.")), Math.max(0, deadline - Date.now()));
        response.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > limits.maxBytes) response.destroy(new UnsafeUrlError(`This file is larger than the ${Math.round(limits.maxBytes / 1048576)} MB limit.`)); });
        response.on("error", (error) => { clearTimeout(timer); file.destroy(); reject(error); });
        file.on("error", (error) => { clearTimeout(timer); response.destroy(); reject(error); });
        file.on("finish", () => { clearTimeout(timer); if (bytes === 0) reject(new UnsafeUrlError("The link returned an empty file.")); else resolve({ done: { bytes, contentType, finalHost: url.hostname } }); });
        response.pipe(file);
      });
      request.on("timeout", () => request.destroy(new UnsafeUrlError("The media server did not respond in time.")));
      request.on("error", (error: NodeJS.ErrnoException) => reject(error.code === "EPRIVATE" ? new UnsafeUrlError("This link points to a local or private network address.") : error instanceof UnsafeUrlError ? error : new UnsafeUrlError("The media file could not be downloaded.")));
    }).catch(async (error) => { await rm(target, { force: true }); throw error; });
    if (result.done) return result.done;
    if (redirects >= (limits.maxRedirects ?? 3)) throw new UnsafeUrlError("The link redirected too many times.");
    url = guards.parse(result.redirect!);
  }
}
