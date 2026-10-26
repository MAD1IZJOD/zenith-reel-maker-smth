import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const expected = process.env.PUBLIC_BASE_URL ? new URL(process.env.PUBLIC_BASE_URL).origin : request.nextUrl.origin;
    if (request.headers.get("sec-fetch-site") === "cross-site" || origin && origin !== expected) return NextResponse.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  }
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, nosnippet");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Permissions-Policy", "camera=(self), microphone=()");
  return response;
}
export const config = { matcher: ["/api/:path*", "/r/:path*", "/operator/:path*", "/festival/:path*", "/display/:path*", "/"] };
