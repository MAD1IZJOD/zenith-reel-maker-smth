import { getRegistration, registrationDays, saveRegistration } from "@/lib/server/registrations";
import { errorResponse, HttpError, rateLimit, requireSession } from "@/lib/server/security";

export const runtime = "nodejs";
type Context = { params: Promise<{ sessionId: string }> };
const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request, context: Context) {
  try {
    const { sessionId } = await context.params;
    await requireSession(request, sessionId);
    return Response.json({ registered: Boolean(await getRegistration(sessionId)), retentionDays: registrationDays() }, { headers });
  } catch (error) { return errorResponse(error); }
}
export async function PUT(request: Request, context: Context) {
  try {
    const { sessionId } = await context.params;
    await requireSession(request, sessionId);
    rateLimit(`registration:${sessionId}`, 20);
    const body = await request.text();
    if (body.length > 4096) throw new HttpError(413, "Registration is too large.");
    await saveRegistration(sessionId, JSON.parse(body));
    return Response.json({ registered: true }, { headers });
  } catch (error) { return errorResponse(error, "Could not save your details. Please retry."); }
}
