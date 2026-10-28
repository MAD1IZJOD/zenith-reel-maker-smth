import { readJsonBody } from "@/lib/server/request-body";
import { NextResponse } from "next/server";
import { issueOperatorCookie, operatorSecret } from "@/lib/server/operator";
import { equalSecret, errorResponse, HttpError, networkKey, rateLimit, secureCookies } from "@/lib/server/security";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    rateLimit(`operator-login:${networkKey(request)}`, 5);
    const { secret } = await readJsonBody(request, 4096);
    if (typeof secret !== "string" || !equalSecret(secret, operatorSecret())) throw new HttpError(401, "Incorrect operator credential.");
    const response = NextResponse.json({ authorized: true });
    response.cookies.set("srs-operator", issueOperatorCookie(), { httpOnly: true, sameSite: "strict", secure: secureCookies(), path: "/api/operator", maxAge: 8 * 3600 });
    return response;
  } catch (error) { return errorResponse(error); }
}
export async function DELETE() { const response = NextResponse.json({ signedOut: true }); response.cookies.set("srs-operator", "", { path: "/api/operator", maxAge: 0 }); return response; }
