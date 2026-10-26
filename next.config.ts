import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [],
  logging: { incomingRequests: false },
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
