import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AudioMode, CaptionStyle, ShotOrder, TypographyStyle } from "@/lib/creative/options";
import { getPreset, type ReelPreset } from "@/lib/presets";
import { ensureSession } from "@/lib/storage/session-storage";
import { probeVideo } from "./metadata";
import { ffmpeg, runProcess } from "./process";
import { createTimeline, type SyncMode } from "@/lib/creative/timeline";
import { getSoundtrack, type MusicId } from "@/lib/creative/music";
import { titleOverlay, fitText } from "./text-layout";

const font = (process.env.FFMPEG_FONT || (process.platform === "win32" ? "C:/Windows/Fonts/arialbd.ttf" : "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")).replace(/\\/g, "/").replace(/:/g, "\\:");
const escapeText = (value: string) => value.replace(/['\\:]/g, "\\$&").replace(/[\r\n]/g, " ").slice(0, 52);
const escapePath = (value: string) => value.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

function captionFilter(caption: string, style: CaptionStyle, text: string): string {
  const styles: Record<CaptionStyle, string> = {
    minimal: "fontcolor=white:fontsize=25:x=(w-text_w)/2:y=h*0.78",
    cinematic: "fontcolor=white:fontsize=28:x=(w-text_w)/2:y=h*0.76:box=1:boxcolor=black@0.32:boxborderw=10",
    bold: "fontcolor=0xC4F46D:fontsize=38:x=(w-text_w)/2:y=h*0.73:box=1:boxcolor=black@0.62:boxborderw=14",
    retro: "fontcolor=0xF3D38A:fontsize=26:x=36:y=h*0.76:box=1:boxcolor=black@0.38:boxborderw=9",
  };
  const fitted = styles[style].replace(/fontsize=(\d+)/, (_, size) => `fontsize=${fitText(text, Number(size))}`);
  return `drawtext=fontfile='${font}':textfile='${escapePath(caption)}':expansion=none:${fitted}`;
}

function effectFilter(preset: ReelPreset, caption: string, captionStyle: CaptionStyle, text: string, overlaysEnabled: boolean): string {
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
  return `${common},${effects[preset.effect]}${overlaysEnabled ? `,${captionFilter(caption, captionStyle, text)}` : ""}`;
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
  sourceDirectory?: string;
  syncMode?: SyncMode;
  musicId?: MusicId;
  customSeconds?: [number, number, number];
  closingTitle?: string;
  typographyStyle?: TypographyStyle;
  titleSeconds?: number;
  overlaysEnabled?: boolean;
  trimStarts?: [number, number, number];
  coverTitle?: string;
  coverFrame?: 0 | 1 | 2;
  onStage?: (stage: "preparing" | "rendering" | "finalizing") => Promise<void>;
};

export async function renderReel({ sessionId, presetId, title, hook, captions, captionStyle = "cinematic", shotOrder = [0, 1, 2], audioMode = "muted", outputName, sourceDirectory, syncMode = "preset", musicId = "pulse", customSeconds = [2, 2, 2], closingTitle, typographyStyle = "editorial", titleSeconds = 2.5, overlaysEnabled = true, trimStarts = [0, 0, 0], coverTitle, coverFrame = 0, onStage }: RenderRequest): Promise<{ output: string; cover: string; covers: string[]; preset: ReelPreset }> {
  const preset = getPreset(presetId);
  if (!preset) throw new Error("Choose a valid reel preset.");
  const timeline = createTimeline(preset, { syncMode, musicId, customSeconds });
  const directory = await ensureSession(sessionId);
  const sourceInputs = [1, 2, 3].map((shot) => path.join(sourceDirectory || directory, `shot-${shot}.mp4`));
  const inputs = shotOrder.map((index) => sourceInputs[index]);
  const normalized = path.join(sourceDirectory || directory, outputName ? `normalized-${path.basename(outputName, ".mp4")}` : "normalized");
  await mkdir(normalized, { recursive: true });
  const normalizedInputs = inputs.map((_, index) => path.join(normalized, `shot-${index + 1}.mp4`));
  const orderedCaptions = shotOrder.map((index) => captions?.[index] || preset.captions[index]);
  const captionFiles = await Promise.all(orderedCaptions.map(async (caption, index) => { const file = path.join(normalized, `caption-${index}.txt`); await writeFile(file, caption.slice(0, 52), "utf8"); return file; }));
  const titleFile = path.join(normalized, "title.txt"); const hookFile = path.join(normalized, "hook.txt");
  const closingFile = path.join(normalized, "closing.txt"), coverTitleFile = path.join(normalized, "cover-title.txt");
  const titleText = (title?.trim() || preset.title).slice(0, 52), closingText = (closingTitle?.trim() || preset.title).slice(0, 52), coverText = (coverTitle?.trim() || titleText).slice(0, 52);
  await Promise.all([writeFile(closingFile, closingText), writeFile(coverTitleFile, coverText)]);
  await Promise.all([writeFile(titleFile, (title?.trim() || preset.title).slice(0, 52)), writeFile(hookFile, (hook?.trim() || preset.title).slice(0, 52))]);
  const sourceMetadata = await Promise.all(inputs.map((input) => probeVideo(input)));
  await onStage?.("preparing");
  for (const [index, input] of inputs.entries()) {
    const trimStart = trimStarts[shotOrder[index]];
    if (trimStart > Math.max(0, sourceMetadata[index].duration - 0.5)) throw new Error(`Shot ${shotOrder[index] + 1} trim starts too late.`);
    const includeOriginalAudio = audioMode === "original" && sourceMetadata[index].hasAudio;
    await runProcess(ffmpeg(), ["-y", "-autorotate", "-ss", String(trimStart), "-i", input, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", String(timeline.clipDurations[index]), "-vf", `${effectFilter(preset, captionFiles[index], captionStyle, orderedCaptions[index], overlaysEnabled)},tpad=stop_mode=clone:stop_duration=${timeline.clipDurations[index]}`, "-map", "0:v:0", "-map", includeOriginalAudio ? "0:a:0" : "1:a:0", "-af", includeOriginalAudio ? "loudnorm=I=-16:TP=-1.5:LRA=11,volume=0.82,apad" : "volume=0", "-c:v", "libx264", "-threads", "2", "-filter_threads", "1", "-preset", "veryfast", "-crf", "21", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-pix_fmt", "yuv420p", normalizedInputs[index]], "FFmpeg normalization");
  }
  const { transitionDuration } = timeline;
  const [offsetOne, offsetTwo] = timeline.cutPositions;
  const openingEnds = Math.min(titleSeconds, timeline.totalDuration - 1.5);
  const closingStarts = Math.max(openingEnds, timeline.totalDuration - 1.5);
  const chosenHook = escapePath(hookFile);
  const label = preset.effect === "retro" ? "REC  •  10.26.2026" : preset.effect === "trailer" ? "ZENITH AGENTIC REEL MAKER PRESENTS" : preset.eyebrow.toUpperCase();
  const overlay = `${titleOverlay(titleFile, titleText, typographyStyle, "opening", `lt(t,${openingEnds})`)},${titleOverlay(closingFile, closingText, typographyStyle, "closing", `gte(t,${closingStarts})`)},drawtext=fontfile='${font}':textfile='${chosenHook}':expansion=none:fontcolor=${preset.effect === "retro" ? "0xF3D38A" : "0xC4F46D"}:fontsize=${fitText(hook || preset.title, 22)}:x=(w-text_w)/2:y=h*0.20:box=1:boxcolor=black@0.28:boxborderw=8:enable='lt(t,${openingEnds})',drawtext=fontfile='${font}':text='${escapeText(label)}':fontcolor=${preset.effect === "retro" ? "0xF3D38A" : "0xC4F46D"}:fontsize=20:x=(w-text_w)/2:y=h*0.88`;
  const output = path.join(directory, outputName || "reel.mp4");
  const renderWithTransition = (transition: ReelPreset["transition"]) => {
    const audioDuration = timeline.totalDuration;
    const track = getSoundtrack(musicId)!;
    const musicInput = audioMode === "soundtrack" ? ["-i", path.join(process.cwd(), "public", track.url)] : [];
    const audioFilter = audioMode === "soundtrack" ? `[3:a]atrim=duration=${audioDuration},asetpts=PTS-STARTPTS,volume=0.8` : `[0:a][1:a]acrossfade=d=${transitionDuration}:c1=tri:c2=tri[am];[am][2:a]acrossfade=d=${transitionDuration}:c1=tri:c2=tri,atrim=duration=${audioDuration}`;
    const complex = `[0:v][1:v]xfade=transition=${transition}:duration=${transitionDuration}:offset=${offsetOne}[mid];[mid][2:v]xfade=transition=${transition}:duration=${transitionDuration}:offset=${offsetTwo},${overlay},format=yuv420p[v];${audioFilter},afade=t=in:st=0:d=0.18,afade=t=out:st=${Math.max(0.1, audioDuration - 0.28).toFixed(2)}:d=0.28[a]`;
    return runProcess(ffmpeg(), ["-y", "-i", normalizedInputs[0], "-i", normalizedInputs[1], "-i", normalizedInputs[2], ...musicInput, "-filter_complex_threads", "1", "-filter_complex", complex, "-map", "[v]", "-map", "[a]", "-r", "30", "-c:v", "libx264", "-threads", "2", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", "-shortest", output], "FFmpeg render");
  };
  await onStage?.("rendering");
  try { await renderWithTransition(preset.transition); } catch (error) { if (preset.transition === "fade") throw error; await renderWithTransition("fade"); }
  await onStage?.("finalizing");
  const baseName = path.basename(output, ".mp4");
  const totalDuration = timeline.totalDuration;
  const positions = [0.55, totalDuration * 0.48, Math.max(0.6, totalDuration - 0.8)];
  const covers: string[] = [];
  for (const [index, position] of positions.entries()) {
    const cover = path.join(directory, `cover-${baseName}-${index + 1}.jpg`);
    const coverOverlay = titleOverlay(coverTitleFile, coverText, typographyStyle, "cover");
    await runProcess(ffmpeg(), ["-y", "-ss", position.toFixed(2), "-i", output, "-frames:v", "1", "-vf", coverOverlay, "-q:v", "2", cover], "FFmpeg cover extraction");
    covers.push(cover);
  }
  return { output, cover: covers[coverFrame], covers, preset };
}
