import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { AudioMode, CaptionStyle, ShotOrder } from "@/lib/creative/options";
import { getPreset, type ReelPreset } from "@/lib/presets";
import { ensureSession } from "@/lib/storage/session-storage";
import { probeVideo } from "./metadata";
import { ffmpeg, runProcess } from "./process";

const font = "C\\:/Windows/Fonts/arialbd.ttf";
const escapeText = (value: string) => value.replace(/['\\:]/g, "\\$&").replace(/[\r\n]/g, " ").slice(0, 52);

function captionFilter(caption: string, style: CaptionStyle): string {
  const styles: Record<CaptionStyle, string> = {
    minimal: "fontcolor=white:fontsize=25:x=(w-text_w)/2:y=h*0.78",
    cinematic: "fontcolor=white:fontsize=28:x=(w-text_w)/2:y=h*0.76:box=1:boxcolor=black@0.32:boxborderw=10",
    bold: "fontcolor=0xC4F46D:fontsize=38:x=(w-text_w)/2:y=h*0.73:box=1:boxcolor=black@0.62:boxborderw=14",
    retro: "fontcolor=0xF3D38A:fontsize=26:x=36:y=h*0.76:box=1:boxcolor=black@0.38:boxborderw=9",
  };
  return `drawtext=fontfile='${font}':text='${escapeText(caption)}':${styles[style]}`;
}

function effectFilter(preset: ReelPreset, caption: string, captionStyle: CaptionStyle): string {
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
  return `${common},${effects[preset.effect]},${captionFilter(caption, captionStyle)}`;
}

export type RenderRequest = {
  sessionId: string;
  presetId: string;
  title?: string;
  hook?: string;
  captions?: [string, string, string];
  captionStyle?: CaptionStyle;
  shotOrder?: ShotOrder;
  audioMode?: AudioMode;
  outputName?: string;
};

export async function renderReel({ sessionId, presetId, title, hook, captions, captionStyle = "cinematic", shotOrder = [0, 1, 2], audioMode = "muted", outputName }: RenderRequest): Promise<{ output: string; cover: string; covers: string[]; preset: ReelPreset }> {
  const preset = getPreset(presetId);
  if (!preset) throw new Error("Choose a valid reel preset.");
  const directory = await ensureSession(sessionId);
  const sourceInputs = [1, 2, 3].map((shot) => path.join(directory, `shot-${shot}.mp4`));
  const inputs = shotOrder.map((index) => sourceInputs[index]);
  const normalized = path.join(directory, "normalized");
  await mkdir(normalized, { recursive: true });
  const normalizedInputs = inputs.map((_, index) => path.join(normalized, `shot-${index + 1}.mp4`));
  const orderedCaptions = shotOrder.map((index) => captions?.[index] || preset.captions[index]);
  const sourceMetadata = await Promise.all(inputs.map((input) => probeVideo(input)));
  await Promise.all(inputs.map((input, index) => {
    const includeOriginalAudio = audioMode === "original" && sourceMetadata[index].hasAudio;
    return runProcess(ffmpeg(), ["-y", "-autorotate", "-i", input, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", String(preset.clipSeconds), "-vf", effectFilter(preset, orderedCaptions[index], captionStyle), "-map", "0:v:0", "-map", includeOriginalAudio ? "0:a:0" : "1:a:0", "-af", includeOriginalAudio ? "loudnorm=I=-16:TP=-1.5:LRA=11,volume=0.82" : "volume=0", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-c:a", "aac", "-ar", "48000", "-pix_fmt", "yuv420p", normalizedInputs[index]], "FFmpeg normalization");
  }));
  const transitionDuration = preset.id === "movie-trailer" ? 0.65 : 0.35;
  const offsetOne = preset.clipSeconds - transitionDuration;
  const offsetTwo = preset.clipSeconds * 2 - transitionDuration * 2;
  const chosenTitle = escapeText(title?.trim() || preset.title);
  const chosenHook = escapeText(hook?.trim() || preset.title);
  const label = preset.effect === "retro" ? "REC  •  10.26.2026" : preset.effect === "trailer" ? "SQUAD REEL STUDIO PRESENTS" : preset.eyebrow.toUpperCase();
  const overlay = `drawtext=fontfile='${font}':text='${chosenTitle}':fontcolor=white:fontsize=43:x=(w-text_w)/2:y=h*0.10:box=1:boxcolor=black@0.38:boxborderw=16,drawtext=fontfile='${font}':text='${chosenHook}':fontcolor=${preset.effect === "retro" ? "0xF3D38A" : "0xC4F46D"}:fontsize=22:x=(w-text_w)/2:y=h*0.18:box=1:boxcolor=black@0.28:boxborderw=8,drawtext=fontfile='${font}':text='${escapeText(label)}':fontcolor=${preset.effect === "retro" ? "0xF3D38A" : "0xC4F46D"}:fontsize=20:x=(w-text_w)/2:y=h*0.88`;
  const output = path.join(directory, outputName || "reel.mp4");
  const renderWithTransition = (transition: ReelPreset["transition"]) => {
    const audioDuration = preset.clipSeconds * 3 - transitionDuration * 2;
    const complex = `[0:v][1:v]xfade=transition=${transition}:duration=${transitionDuration}:offset=${offsetOne}[mid];[mid][2:v]xfade=transition=${transition}:duration=${transitionDuration}:offset=${offsetTwo},${overlay},format=yuv420p[v];[0:a][1:a][2:a]concat=n=3:v=0:a=1,atrim=duration=${audioDuration.toFixed(2)},afade=t=in:st=0:d=0.18,afade=t=out:st=${Math.max(0.1, audioDuration - 0.28).toFixed(2)}:d=0.28[a]`;
    return runProcess(ffmpeg(), ["-y", "-i", normalizedInputs[0], "-i", normalizedInputs[1], "-i", normalizedInputs[2], "-filter_complex", complex, "-map", "[v]", "-map", "[a]", "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", "-shortest", output], "FFmpeg render");
  };
  try { await renderWithTransition(preset.transition); } catch (error) { if (preset.transition === "fade") throw error; await renderWithTransition("fade"); }
  const baseName = path.basename(output, ".mp4");
  const totalDuration = preset.clipSeconds * 3 - transitionDuration * 2;
  const positions = [0.55, totalDuration * 0.48, Math.max(0.6, totalDuration - 0.8)];
  const covers = await Promise.all(positions.map(async (position, index) => {
    const cover = path.join(directory, `cover-${baseName}-${index + 1}.jpg`);
    const coverOverlay = `drawtext=fontfile='${font}':text='${chosenTitle}':fontcolor=white:fontsize=43:x=(w-text_w)/2:y=h*0.12:box=1:boxcolor=black@0.42:boxborderw=16`;
    await runProcess(ffmpeg(), ["-y", "-ss", position.toFixed(2), "-i", output, "-frames:v", "1", "-vf", coverOverlay, "-q:v", "2", cover], "FFmpeg cover extraction");
    return cover;
  }));
  return { output, cover: covers[0], covers, preset };
}
