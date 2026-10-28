import http from "node:http";
import https from "node:https";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
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
  const controller = new AbortController();
  const timeoutError = new UnsafeUrlError("The download took too long.");
  const timer = setTimeout(() => controller.abort(timeoutError), limits.timeoutMs);
  const aborted = new Promise<never>((_resolve, reject) => controller.signal.addEventListener("abort", () => reject(timeoutError), { once: true }));
  try {
  for (let redirects = 0; ; redirects++) {
    await Promise.race([guards.assertHost(url), aborted]);
    const result = await new Promise<{ redirect?: string; done?: DownloadResult }>((resolve, reject) => {
      const client = url.protocol === "https:" ? https : http;
      let streaming = false;
      const request = client.get(url, { signal: controller.signal, lookup: guards.lookup as never, headers: { "User-Agent": "ZenithReelMaker/1.0 (+media import)", Accept: "video/*,audio/*;q=0.9,*/*;q=0.1" } }, (response) => {
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.destroy();
          try { return resolve({ redirect: new URL(response.headers.location, url).toString() }); }
          catch { return reject(new UnsafeUrlError("The media server returned an invalid redirect.")); }
        }
        if (status !== 200) { response.destroy(); return reject(new UnsafeUrlError(`The media server answered ${status}. Check that the link opens the file directly.`)); }
        const contentType = String(response.headers["content-type"] || "application/octet-stream").split(";")[0].trim();
        if (!MEDIA_TYPES.test(contentType)) { response.destroy(); return reject(new UnsafeUrlError("This link is a web page, not a media file. Use a direct link to an MP4, MOV, WebM, MP3, M4A or WAV file.")); }
        const declared = Number(response.headers["content-length"]);
        if (Number.isFinite(declared) && declared > limits.maxBytes) { response.destroy(); return reject(new UnsafeUrlError(`This file is larger than the ${Math.round(limits.maxBytes / 1048576)} MB limit.`)); }
        let bytes = 0;
        const bound = new Transform({ transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          callback(bytes > limits.maxBytes ? new UnsafeUrlError(`This file is larger than the ${Math.round(limits.maxBytes / 1048576)} MB limit.`) : null, chunk);
        } });
        // pipeline settles after streams close, so Windows can remove partial files reliably.
        streaming = true;
        void pipeline(response, bound, createWriteStream(target, { mode: 0o600 }), { signal: controller.signal }).then(() => {
          if (bytes === 0) reject(new UnsafeUrlError("The link returned an empty file."));
          else resolve({ done: { bytes, contentType, finalHost: url.hostname } });
        }, reject);
      });
      request.on("error", (error: NodeJS.ErrnoException) => {
        if (!streaming) reject(error.code === "EPRIVATE" ? new UnsafeUrlError("This link points to a local or private network address.") : error instanceof UnsafeUrlError ? error : new UnsafeUrlError("The media file could not be downloaded."));
      });
    });
    if (result.done) return result.done;
    if (redirects >= (limits.maxRedirects ?? 3)) throw new UnsafeUrlError("The link redirected too many times.");
    url = guards.parse(result.redirect!);
  }
  } catch (error) {
    await rm(target, { force: true, maxRetries: 5, retryDelay: 100 });
    throw controller.signal.aborted ? timeoutError : error;
  } finally { clearTimeout(timer); }
}
