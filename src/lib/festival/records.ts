import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { dataRoot } from "@/lib/server/config";
import { readJson } from "@/lib/server/store";
export async function records<T>(collection: string): Promise<T[]> {
  const directory = path.join(dataRoot(), collection); await mkdir(directory, { recursive: true });
  const output: T[] = [];
  for (const entry of await readdir(directory)) {
    if (!/^[a-f0-9-]{36,64}\.json$/i.test(entry)) continue;
    const value = await readJson<T>(path.join(directory, entry)); if (value) output.push(value);
  }
  return output;
}
export const eventDay = (time = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(time);
