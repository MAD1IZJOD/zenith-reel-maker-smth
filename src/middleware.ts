import { NextRequest, NextResponse } from "next/server";
import { crossOriginReason } from "@/lib/server/origin";

export function middleware(request: NextRequest) {
  const blocked = crossOriginReason(request.method, request.headers, request.nextUrl.origin);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 403 });
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, nosnippet");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Permissions-Policy", "camera=(self), microphone=()");
  return response;
}
// Media upload routes are excluded: Next.js clones request bodies for middleware and truncates them past
// middlewareClientMaxBodySize (10 MB). Those routes stream to disk and apply the same origin check themselves.
export const config = { matcher: ["/api/((?!uploads|sources/upload).*)", "/r/:path*", "/operator/:path*", "/festival/:path*", "/display/:path*", "/podcast/:path*", "/"] };
