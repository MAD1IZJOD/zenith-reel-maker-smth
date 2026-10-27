import { requireOperator } from "@/lib/server/operator";
import { errorResponse } from "@/lib/server/security";
import { registrationCsv } from "@/lib/server/registrations";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    requireOperator(request);
    return new Response(await registrationCsv(), { headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="zenith-registrations.csv"',
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return errorResponse(error); }
}
