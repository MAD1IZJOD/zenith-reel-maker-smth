import { spawn } from "node:child_process";

export function runProcess(command: string, args: string[], label: string, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let timedOut = false;
    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.on("error", (error) => { clearTimeout(timeout); reject(new Error(`${label} could not start: ${error.message}`)); });
    child.on("close", (code) => { clearTimeout(timeout); if (timedOut) reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds.`)); else if (code === 0) resolve(stdout); else reject(new Error(`${label} failed (${code}): ${stderr.slice(-1200)}`)); });
  });
}

export const ffmpeg = () => process.env.FFMPEG_PATH || "ffmpeg";
export const ffprobe = () => process.env.FFPROBE_PATH || "ffprobe";
