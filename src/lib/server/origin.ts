/** Same-origin enforcement for state-changing requests, shared by middleware and routes that bypass it. */
export function crossOriginReason(method: string, headers: Headers, requestOrigin: string): string | undefined {
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return undefined;
  const origin = headers.get("origin");
  const expected = process.env.PUBLIC_BASE_URL ? new URL(process.env.PUBLIC_BASE_URL).origin : requestOrigin;
  if (headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== expected)) return "Cross-origin requests are not allowed.";
  return undefined;
}
