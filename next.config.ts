import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [],
  logging: { incomingRequests: false },
  experimental: { cpus: 2 },
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
