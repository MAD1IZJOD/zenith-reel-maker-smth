import { BlockList, isIP } from "node:net";
import { lookup } from "node:dns/promises";

/**
 * Server-side request forgery defences for visitor-supplied media links. A URL is accepted only when it is
 * plain http(s) on a standard port, has no embedded credentials, and every address it resolves to is public.
 * The same address check runs again at connect time (see safeLookup) so DNS rebinding cannot bypass it.
 */
export class UnsafeUrlError extends Error {}

const blocked = new BlockList();
for (const [network, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8], ["2001:db8::", 32], ["100::", 64], ["2002::", 16]] as const) blocked.addSubnet(network, prefix, "ipv6");
// Reject address-translation/tunnelling ranges as a whole, including fully expanded spellings.
// Their embedded IPv4 destination may be private even when the outer IPv6 address looks public.
for (const [network, prefix] of [["::", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["2001::", 32]] as const) blocked.addSubnet(network, prefix, "ipv6");

/** True for loopback, private, link-local (including cloud metadata 169.254.169.254), multicast, reserved and documentation ranges. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family !== 6) return true;
  if (blocked.check(address, "ipv6")) return true;
  const lower = address.toLowerCase();
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible and NAT64 (64:ff9b::/96) forms embed an IPv4 target.
  const embedded = lower.match(/^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (embedded) return isPrivateAddress(embedded);
  const hex = lower.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) { const value = (parseInt(hex[1], 16) << 16 >>> 0) + parseInt(hex[2], 16); return isPrivateAddress([value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".")); }
  return blocked.check(address, "ipv6");
}

/** Video platforms whose pages are not media files; retrieving from them needs the creator's own export. */
const PLATFORM_HOSTS = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|instagram\.com|tiktok\.com|facebook\.com|fb\.watch|x\.com|twitter\.com|vimeo\.com|twitch\.tv|spotify\.com|podcasts\.apple\.com|soundcloud\.com|dailymotion\.com|linkedin\.com|snapchat\.com)$/i;

export function parseMediaUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new UnsafeUrlError("Enter a complete link starting with https://."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UnsafeUrlError("Only http and https media links are supported.");
  if (url.username || url.password) throw new UnsafeUrlError("Links with embedded usernames or passwords are not accepted.");
  if (url.port && !["80", "443"].includes(url.port)) throw new UnsafeUrlError("Only standard web ports are supported.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || /\.(localhost|local|internal|intranet|lan|home|corp)$/.test(host) || !host.includes(".") && !isIP(host)) throw new UnsafeUrlError("Local and private network addresses are not allowed.");
  if (isIP(host) && isPrivateAddress(host)) throw new UnsafeUrlError("Local and private network addresses are not allowed.");
  if (PLATFORM_HOSTS.test(host)) throw new UnsafeUrlError("Links to video or podcast platform pages are not supported. Download your own episode from the platform's creator tools and upload the file, or use a direct link to a media file you are permitted to use.");
  if (raw.length > 2048) throw new UnsafeUrlError("This link is too long.");
  return url;
}

/** Resolves every address for a host and rejects the URL if any of them is non-public. */
export async function assertPublicHost(url: URL, resolve: typeof lookup = lookup): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) { if (isPrivateAddress(host)) throw new UnsafeUrlError("Local and private network addresses are not allowed."); return; }
  let addresses: { address: string }[];
  try { addresses = await resolve(host, { all: true, verbatim: true }); } catch { throw new UnsafeUrlError("This link's server could not be found."); }
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) throw new UnsafeUrlError("This link points to a local or private network address.");
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void;
/** A connect-time lookup for http(s).request that refuses private targets, closing the DNS-rebinding window. */
export function safeLookup(hostname: string, options: { all?: boolean; family?: number } | number, callback: LookupCallback): void {
  const opts = typeof options === "number" ? { family: options } : options || {};
  lookup(hostname, { all: true, verbatim: true, family: opts.family as 0 | 4 | 6 | undefined }).then((addresses) => {
    const unsafe = addresses.find((entry) => isPrivateAddress(entry.address));
    if (unsafe || !addresses.length) { const error = new Error("Refusing to connect to a private network address.") as NodeJS.ErrnoException; error.code = "EPRIVATE"; return callback(error, ""); }
    if (opts.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  }, (error: NodeJS.ErrnoException) => callback(error, ""));
}
