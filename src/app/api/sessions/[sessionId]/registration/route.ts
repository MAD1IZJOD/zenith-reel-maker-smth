import { getRegistration, registrationDays, saveRegistration } from "@/lib/server/registrations";
import { errorResponse, rateLimit, requireSession } from "@/lib/server/security";
import { readJsonBody } from "@/lib/server/request-body";

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
    await saveRegistration(sessionId, await readJsonBody(request, 4096));
    return Response.json({ registered: true }, { headers });
  } catch (error) { return errorResponse(error, "Could not save your details. Please retry."); }
}
