import { mkdir } from "node:fs/promises";
import path from "node:path";
import { getPreset, type ReelPreset } from "@/lib/presets";
import { ensureSession } from "@/lib/storage/session-storage";
import { ffmpeg, runProcess } from "./process";

const font = "C\\:/Windows/Fonts/arialbd.ttf";
const escapeText = (value: string) => value.replace(/['\\:]/g, "\\$&").replace(/[\r\n]/g, " ").slice(0, 52);

function effectFilter(preset: ReelPreset, caption: string): string {
  const common = "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=30,setsar=1";
  const effects: Record<ReelPreset["effect"], string> = {
    cinema: "eq=contrast=1.22:saturation=0.82:brightness=-0.03,vignette=PI/5",
    punch: "eq=contrast=1.28:saturation=1.35,unsharp=5:5:0.8",
    reveal: "eq=contrast=1.08:saturation=1.45:brightness=0.04",
    suspense: "eq=contrast=1.35:saturation=0.45:brightness=-0.07,vignette=PI/4",
    retro: "eq=contrast=0.88:saturation=0.65:brightness=0.08,colorchannelmixer=rr=1.10:gg=0.96:bb=0.76,noise=alls=11:allf=t",
    party: "eq=contrast=1.15:saturation=1.55:brightness=0.03",
    trailer: "eq=contrast=1.28:saturation=0.62:brightness=-0.04,vignette=PI/4",
  };
  return `${common},${effects[preset.effect]},drawtext=fontfile='${font}':text='${escapeText(caption)}':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=h*0.76:box=1:boxcolor=black@0.32:boxborderw=10`;
}

export async function renderReel({ sessionId, presetId, title, outputName }: { sessionId: string; presetId: string; title?: string; outputName?: string }): Promise<{ output: string; cover: string; preset: ReelPreset }> {
  const preset = getPreset(presetId);
  if (!preset) throw new Error("Choose a valid reel preset.");
  const directory = await ensureSession(sessionId);
  const inputs = [1, 2, 3].map((shot) => path.join(directory, `shot-${shot}.mp4`));
  const normalized = path.join(directory, "normalized");
  await mkdir(normalized, { recursive: true });
  const normalizedInputs = inputs.map((_, index) => path.join(normalized, `shot-${index + 1}.mp4`));
  await Promise.all(inputs.map((input, index) => runProcess(ffmpeg(), ["-y", "-autorotate", "-i", input, "-an", "-t", String(preset.clipSeconds), "-vf", effectFilter(preset, preset.captions[index]), "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", normalizedInputs[index]], "FFmpeg normalization")));
  const transitionDuration = preset.id === "movie-trailer" ? 0.65 : 0.35;
  const offsetOne = preset.clipSeconds - transitionDuration;
  const offsetTwo = preset.clipSeconds * 2 - transitionDuration * 2;
  const chosenTitle = escapeText(title?.trim() || preset.title);
  const label = preset.effect === "retro" ? "REC  •  10.26.2026" : preset.effect === "trailer" ? "SQUAD REEL STUDIO PRESENTS" : preset.eyebrow.toUpperCase();
  const overlay = `drawtext=fontfile='${font}':text='${chosenTitle}':fontcolor=white:fontsize=43:x=(w-text_w)/2:y=h*0.12:box=1:boxcolor=black@0.38:boxborderw=16,drawtext=fontfile='${font}':text='${escapeText(label)}':fontcolor=${preset.effect === "retro" ? "0xF3D38A" : "0xC4F46D"}:fontsize=20:x=(w-text_w)/2:y=h*0.88`;
  const output = path.join(directory, outputName || "reel.mp4");
  const renderWithTransition = (transition: ReelPreset["transition"]) => {
    const complex = `[0:v][1:v]xfade=transition=${transition}:duration=${transitionDuration}:offset=${offsetOne}[mid];[mid][2:v]xfade=transition=${transition}:duration=${transitionDuration}:offset=${offsetTwo},${overlay},format=yuv420p[v]`;
    return runProcess(ffmpeg(), ["-y", "-i", normalizedInputs[0], "-i", normalizedInputs[1], "-i", normalizedInputs[2], "-filter_complex", complex, "-map", "[v]", "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-movflags", "+faststart", output], "FFmpeg render");
  };
  try { await renderWithTransition(preset.transition); } catch (error) { if (preset.transition === "fade") throw error; await renderWithTransition("fade"); }
  const cover = path.join(directory, `cover-${path.basename(output, ".mp4")}.jpg`);
  await runProcess(ffmpeg(), ["-y", "-ss", "1", "-i", output, "-frames:v", "1", "-q:v", "2", cover], "FFmpeg cover extraction");
  return { output, cover, preset };
}
