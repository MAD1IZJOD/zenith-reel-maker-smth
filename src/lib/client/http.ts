/**
 * Browsers keep a request open until its response body is read or cancelled; with HTTP/1.1's six connections per
 * host, unread responses (status-only checks, analytics pings) starved uploads, polls and video loads for up to the
 * request timeout. Every response used only for its status goes through here.
 */
export async function settle(response: Response): Promise<Response> {
  // These are small JSON replies: reading them to the end completes the request cleanly (cancelling shows as aborted).
  try { await response.arrayBuffer(); } catch { /* already consumed or connection closed */ }
  return response;
}

/** Fire-and-forget POST whose body is released immediately; failures are ignored by design. */
export function ping(url: string, payload: unknown): void {
  void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), keepalive: true }).then(settle).catch(() => undefined);
}
