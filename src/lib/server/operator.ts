import { createHmac } from "node:crypto";
import { cookie, equalSecret, HttpError } from "./security";
const signature = (value: string, secret: string) => createHmac("sha256", secret).update(`operator:${value}`).digest("hex");
export function operatorSecret() {
  const secret = process.env.OPERATOR_SECRET;
  if (!secret || secret.length < 32) throw new HttpError(503, "Operator access is disabled. Configure OPERATOR_SECRET with at least 32 random characters.");
  return secret;
}
export function issueOperatorCookie() { const expiry = String(Date.now() + 8 * 3_600_000); return `${expiry}.${signature(expiry, operatorSecret())}`; }
export function requireOperator(request: Request) {
  const secret = operatorSecret(); const [expiry, supplied] = cookie(request, "srs-operator").split(".");
  if (!/^\d{13}$/.test(expiry || "") || Number(expiry) <= Date.now() || Number(expiry) > Date.now() + 8 * 3_600_000 || !supplied || !equalSecret(supplied, signature(expiry, secret))) throw new HttpError(401, "Operator sign-in required.");
}
