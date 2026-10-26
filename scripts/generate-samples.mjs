import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const output = path.join(process.cwd(), "public", "samples");
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const run = (args) => new Promise((resolve, reject) => { const child = spawn(ffmpeg, args, { windowsHide: true }); let error = ""; child.stderr.on("data", (chunk) => error += chunk); child.on("error", reject); child.on("close", (code) => code ? reject(new Error(error.slice(-800))) : resolve()); });
await mkdir(output, { recursive: true });
const clips = [
  ["0x253a58", "SQUAD ONE"],
  ["0x613f29", "SQUAD TWO"],
  ["0x2f573f", "SQUAD THREE"],
];
for (let index = 0; index < clips.length; index += 1) {
  const [color, label] = clips[index];
  await run(["-y", "-f", "lavfi", "-i", `color=c=${color}:s=720x1280:r=30:d=4`, "-vf", `drawtext=fontfile='C\\:/Windows/Fonts/arialbd.ttf':text='${label}':fontcolor=white:fontsize=60:x=(w-text_w)/2:y=(h-text_h)/2`, "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(output, `shot-${index + 1}.mp4`)]);
}
console.log(`Generated ${clips.length} local sample clips in ${output}`);
