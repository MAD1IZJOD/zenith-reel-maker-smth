import { spawn } from "node:child_process";
import path from "node:path";
const child = spawn(process.execPath, [path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next"), "build"], { stdio: "inherit", windowsHide: true, env: { ...process.env, NEXT_DIST_DIR: process.env.VERCEL === "1" ? ".next" : ".next-production" } });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code || 0; });
