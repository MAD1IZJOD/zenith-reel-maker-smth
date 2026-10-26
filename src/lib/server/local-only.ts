/**
 * Operator screens and model diagnostics can be limited to the stall computer itself (OPERATOR_LOCAL_ONLY=true), so a
 * public tunnel or LAN address never serves them. Edge-safe: used by middleware, so no Node imports.
 */
export const LOCAL_ONLY_PATHS = /^\/(?:operator|api\/operator|api\/ai)(?:\/|$)/;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "::ffff:127.0.0.1"]);

const hostName = (host: string) => (host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0]).toLowerCase();

/** True only for a request typed on this machine: loopback Host, no tunnel headers, and only loopback forwarding hops. */
export function isLoopbackRequest(headers: Headers): boolean {
  if (!LOOPBACK.has(hostName(headers.get("host") || ""))) return false;
  if (headers.has("cf-connecting-ip") || headers.has("cf-ray") || headers.has("forwarded")) return false;
  const hops = (headers.get("x-forwarded-for") || "").split(",").map((hop) => hop.trim()).filter(Boolean);
  return hops.every((hop) => LOOPBACK.has(hop.toLowerCase()));
}

export function blockedForPublic(pathname: string, headers: Headers, env: Record<string, string | undefined> = process.env): boolean {
  return env.OPERATOR_LOCAL_ONLY === "true" && LOCAL_ONLY_PATHS.test(pathname) && !isLoopbackRequest(headers);
}
