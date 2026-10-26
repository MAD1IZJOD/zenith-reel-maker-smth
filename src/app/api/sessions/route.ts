import { NextResponse } from "next/server";
import { createSessionId } from "@/lib/storage/session-storage";
import { errorResponse, issueSession, networkKey, rateLimit, secureCookies, sessionCookie } from "@/lib/server/security";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    rateLimit(`session:${networkKey(request)}`, 60);
    const id = createSessionId();
    const { access, token } = await issueSession(id);
    const response = NextResponse.json({ sessionId: id, expiresAt: access.expiresAt });
    response.cookies.set(sessionCookie(id), token, { httpOnly: true, sameSite: "strict", secure: secureCookies(), path: "/", maxAge: Math.floor((access.expiresAt - Date.now()) / 1000) });
    return response;
  } catch (error) { return errorResponse(error); }
}
