import type { NextConfig } from "next";

// Vercel is the public entry point; the persistent Node host owns media and jobs.
// A temporary redirect also keeps large uploads out of serverless request limits.
function studioOrigin() {
  if (process.env.VERCEL !== "1") return undefined;
  const value = process.env.STUDIO_ORIGIN;
  if (!value) throw new Error("Set STUDIO_ORIGIN to the HTTPS URL of the running studio before deploying to Vercel.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.hostname.endsWith(".vercel.app")) {
    throw new Error("STUDIO_ORIGIN must be the studio's HTTPS origin, without credentials, path, query, or a Vercel redirect loop.");
  }
  return url.origin;
}
const origin = studioOrigin();

const nextConfig: NextConfig = {
  serverExternalPackages: [],
  logging: { incomingRequests: false },
  experimental: { cpus: 2 },
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async redirects() {
    return origin ? [{ source: "/:path*", destination: `${origin}/:path*`, permanent: false }] : [];
  },
};

export default nextConfig;
