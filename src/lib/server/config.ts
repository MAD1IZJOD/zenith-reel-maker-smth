import path from "node:path";
export const dataRoot = () => path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
export function limit(name: string, fallback: number, maximum = 10000): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.min(maximum, Math.floor(value)) : fallback;
}
export const retentionMs = () => limit("RETENTION_HOURS", 24, 168) * 3_600_000;
