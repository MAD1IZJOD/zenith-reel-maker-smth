import { spawn } from "node:child_process";

export function runProcess(command: string, args: string[], label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => reject(new Error(`${label} could not start: ${error.message}`)));
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`${label} failed (${code}): ${stderr.slice(-1200)}`)));
  });
}

export const ffmpeg = () => process.env.FFMPEG_PATH || "ffmpeg";
export const ffprobe = () => process.env.FFPROBE_PATH || "ffprobe";
