import { spawn, type ChildProcess } from "node:child_process";
const global = globalThis as typeof globalThis & { studioChildProcesses?: Set<ChildProcess>; studioPeakChildren?: number; studioVideoProcesses?: { active: number; peak: number } };
const children = global.studioChildProcesses ||= new Set();
const videoProcesses = global.studioVideoProcesses ||= { active: 0, peak: 0 };
export const mediaProcessStats = () => ({ ...videoProcesses });

export function runProcess(command: string, args: string[], label: string, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    children.add(child); global.studioPeakChildren = Math.max(global.studioPeakChildren || 0, children.size);
    let counted = command === ffmpeg() && !args.includes("-version");
    if (counted) { videoProcesses.active++; videoProcesses.peak = Math.max(videoProcesses.peak, videoProcesses.active); }
    const release = () => { children.delete(child); if (counted) { counted = false; videoProcesses.active--; } };
    let timedOut = false;
    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk.toString()).slice(-1_000_000); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-8_000); });
    const timeout = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.on("error", (error) => { release(); clearTimeout(timeout); reject(new Error(`${label} could not start: ${error.message}`)); });
    child.on("close", (code) => { release(); clearTimeout(timeout); if (timedOut) reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds.`)); else if (code === 0) resolve(stdout); else reject(new Error(`${label} failed (${code}): ${stderr.slice(-1200)}`)); });
  });
}

export const ffmpeg = () => process.env.FFMPEG_PATH || "ffmpeg";
export const ffprobe = () => process.env.FFPROBE_PATH || "ffprobe";
