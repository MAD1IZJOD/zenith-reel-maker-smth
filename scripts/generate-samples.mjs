import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const output = path.join(process.cwd(), "public", "samples");
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const font = (process.env.FFMPEG_FONT || (process.platform === "win32" ? "C:/Windows/Fonts/arialbd.ttf" : "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")).replace(/\\/g, "/").replace(/:/g, "\\:");
const run = (args) => new Promise((resolve, reject) => { const child = spawn(ffmpeg, args, { windowsHide: true }); let error = ""; child.stderr.on("data", (chunk) => error += chunk); child.on("error", reject); child.on("close", (code) => code ? reject(new Error(error.slice(-800))) : resolve()); });
await mkdir(output, { recursive: true });
const clips = [
  ["0xC5F277", "ARRIVE"],
  ["0x9DADFF", "CONNECT"],
  ["0x68D3A2", "REVEAL"],
];
for (let index = 0; index < clips.length; index += 1) {
  const [color, label] = clips[index];
  const treatment = [
    "drawgrid=width=120:height=160:thickness=1:color=white@0.04",
    `drawbox=x=52:y=155:w=616:h=960:color=${color}@0.6:t=2`,
    `drawtext=fontfile='${font}':text='ZENITH / MOTION STUDY':fontcolor=white:fontsize=21:x=54:y=100`,
    `drawtext=fontfile='${font}':text='0${index + 1}':fontcolor=${color}:fontsize=290:x=(w-text_w)/2+18*sin(t*1.2):y=h*0.29+15*cos(t)`,
    `drawtext=fontfile='${font}':text='${label}':fontcolor=white:fontsize=52:x=(w-text_w)/2:y=h*0.64`,
    `drawtext=fontfile='${font}':text='THREE MOMENTS. YOUR STORY.':fontcolor=white@0.55:fontsize=18:x=(w-text_w)/2:y=h*0.72`,
    `drawtext=fontfile='${font}':text='ORIGINAL SYNTHETIC SAMPLE':fontcolor=white@0.55:fontsize=16:x=54:y=1160`,
  ].join(",");
  await run(["-y", "-f", "lavfi", "-i", "color=c=0x111318:s=720x1280:r=30:d=4", "-vf", treatment, "-c:v", "libx264", "-threads", "2", "-crf", "24", "-pix_fmt", "yuv420p", path.join(output, `shot-${index + 1}.mp4`)]);
}
console.log(`Generated ${clips.length} local sample clips in ${output}`);
