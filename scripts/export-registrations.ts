import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataRoot } from "../src/lib/server/config";
import { registrationCsv } from "../src/lib/server/registrations";

async function main() {
  const file = path.join(dataRoot(), "private-exports", `registrations-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.csv`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, await registrationCsv(), { mode: 0o600, flag: "wx" });
  console.log(`Private CSV saved to ${file}`);
}
void main().catch(() => { console.error("Could not export registrations. Check DATA_DIR and folder permissions."); process.exitCode = 1; });
