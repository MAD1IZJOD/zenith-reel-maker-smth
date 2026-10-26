import path from "node:path";
import { edlDuration, type EditDecisionList, type EdlSegment } from "@/lib/edit/edl";
import { gradeFilter, type Transition } from "@/lib/edit/styles";

/** FFmpeg filter-argument escaping for paths inside single quotes (drive colons, quotes, backslashes). */
export const filterPath = (value: string) => value.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
const num = (value: number) => Number(value.toFixed(4)).toString();

export type CompileContext = {
  /** Trusted absolute path for each EDL source index. Never derived from visitor or model input. */
  sourcePaths: string[];
  musicPath?: string;
  fontsDir: string;
  videoAss: string;
  coverAss: string;
  output: string;
  /** printf-style image2 pattern, e.g. cover-reel-<id>-%d.jpg */
  coverPattern: string;
  encoder?: "libx264" | "h264_amf";
  threads?: number;
};

const XFADE: Record<Exclude<Transition, "cut" | "flash">, string> = { dissolve: "fade", whip: "slideleft", push: "zoomin" };

/** How much source time a segment consumes, including the overlap it lends to its outgoing transition. */
export const sourceSeconds = (segment: EdlSegment) => segment.duration * segment.speed;

function framing(edl: EditDecisionList, segment: EdlSegment, index: number, quality: boolean): string {
  const { width: W, height: H } = edl.canvas;
  const source = edl.sources[segment.source];
  const flags = quality ? "lanczos" : "bicubic";
  const amount = 0.065;
  const label = `s${index}`;
  let chain: string;
  if (segment.crop === "fit-blur") {
    const aspect = source.width / source.height;
    const fgHeight = Math.min(H, Math.max(Math.round(W / aspect), Math.round(H * 0.4)));
    const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
    const bgW = even(W / 8), bgH = even(H / 8);
    chain = `split=2[${label}b][${label}f];[${label}b]scale=${bgW}:${bgH}:force_original_aspect_ratio=increase,crop=${bgW}:${bgH},boxblur=5:2,scale=${W}:${H}:flags=bicubic,eq=brightness=-0.08:saturation=0.78[${label}bg];[${label}f]scale=-2:${even(fgHeight)}:flags=${flags},crop='min(iw,${W})':ih:(iw-ow)*${num(segment.focusX)}:0[${label}fg];[${label}bg][${label}fg]overlay=(W-w)/2:(H-h)/2`;
  } else {
    chain = `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=${flags},crop=${W}:${H}:(iw-ow)*${num(segment.focusX)}:(ih-oh)/2`;
  }
  const D = num(segment.duration);
  switch (segment.motion) {
    case "push-in": chain += `,scale=w='2*trunc(${W}*(1+${amount}*min(t/${D},1))/2)':h=-2:eval=frame:flags=${flags},crop=${W}:${H}`; break;
    case "pull-out": chain += `,scale=w='2*trunc(${W}*(1+${amount}*(1-min(t/${D},1)))/2)':h=-2:eval=frame:flags=${flags},crop=${W}:${H}`; break;
    case "drift-left":
    case "drift-right": {
      const from = segment.motion === "drift-left" ? 0.8 : 0.2, to = 1 - from;
      chain += `,scale=${2 * Math.round((W * (1 + amount)) / 2)}:-2:flags=${flags},crop=${W}:${H}:x='(iw-ow)*(${from}+(${to - from})*min(t/${D},1))':y=(ih-oh)/2`;
      break;
    }
    case "none": break;
  }
  return chain;
}

export function compileEdl(edl: EditDecisionList, context: CompileContext): string[] {
  const quality = edl.profile === "quality";
  const total = edlDuration(edl);
  const { width: W, height: H, fps } = edl.canvas;
  const args: string[] = ["-y", "-v", "error", "-nostdin"];
  const graph: string[] = [];

  // One input per segment, trimmed at the demuxer so only the needed source is decoded.
  edl.segments.forEach((segment) => {
    const path = context.sourcePaths[segment.source];
    if (!path) throw new Error("Edit references a missing source.");
    args.push("-ss", num(segment.start), "-t", num(sourceSeconds(segment) + 0.1), "-i", path);
  });
  const music = edl.audio.mode === "soundtrack" || edl.audio.mode === "mix";
  if (music) {
    if (!context.musicPath) throw new Error("Soundtrack unavailable.");
    args.push("-stream_loop", "-1", "-i", context.musicPath);
  }
  const musicInput = edl.segments.length;
  const useOriginal = edl.audio.mode === "original" || edl.audio.mode === "mix";

  edl.segments.forEach((segment, index) => {
    const D = num(segment.duration);
    graph.push(`[${index}:v]setpts=(PTS-STARTPTS)/${num(segment.speed)},fps=${fps},${framing(edl, segment, index, quality)},setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=${D},trim=duration=${D},setpts=PTS-STARTPTS,settb=AVTB[v${index}]`);
    const hasAudio = useOriginal && edl.sources[segment.source].hasAudio;
    graph.push(hasAudio
      ? `[${index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo${segment.speed !== 1 ? `,atempo=${num(segment.speed)}` : ""},apad,atrim=duration=${D},asetpts=PTS-STARTPTS[a${index}]`
      : `anullsrc=r=48000:cl=stereo,atrim=duration=${D},aformat=sample_fmts=fltp:channel_layouts=stereo[a${index}]`);
  });

  // Join left to right. Cuts concatenate; crossfading transitions overlap video and audio identically.
  let video = "v0", audio = "a0", length = edl.segments[0].duration;
  edl.transitions.forEach((transition, index) => {
    const next = index + 1, outV = `jv${next}`, outA = `ja${next}`;
    if (transition.type === "cut" || transition.type === "flash") {
      graph.push(`[${video}][v${next}]concat=n=2:v=1:a=0,settb=AVTB[${outV}]`, `[${audio}][a${next}]concat=n=2:v=0:a=1[${outA}]`);
    } else {
      graph.push(`[${video}][v${next}]xfade=transition=${XFADE[transition.type]}:duration=${num(transition.duration)}:offset=${num(length - transition.duration)}[${outV}]`, `[${audio}][a${next}]acrossfade=d=${num(transition.duration)}:c1=tri:c2=tri[${outA}]`);
    }
    length += edl.segments[next].duration - transition.duration;
    video = outV; audio = outA;
  });

  // Look: accents, then one consistent grade over the whole timeline, then optional texture.
  const accents = edl.accents.map((time) => `if(between(t,${num(time)},${num(time + 0.14)}),0.3*(1-(t-${num(time)})/0.14),0)`);
  const look = [accents.length ? `eq=brightness='${accents.join("+")}':eval=frame` : "", gradeFilter(edl.grade, quality), quality ? "unsharp=5:5:0.35" : ""].filter(Boolean).join(",");
  const fonts = filterPath(context.fontsDir);
  graph.push(`[${video}]${look},split=2[graded][coverbase]`);
  graph.push(`[graded]subtitles=filename='${filterPath(context.videoAss)}':fontsdir='${fonts}',trim=duration=${num(total)},setpts=PTS-STARTPTS[vout]`);
  const frames = edl.cover.times.map((time) => Math.max(0, Math.min(Math.round(time * fps), Math.round(total * fps) - 2)));
  graph.push(`[coverbase]select='${frames.map((frame) => `eq(n,${frame})`).join("+")}',subtitles=filename='${filterPath(context.coverAss)}':fontsdir='${fonts}'[cover]`);

  // Sound: original speech, licensed music ducked under it, then fades, loudness and a peak limiter.
  const fadeOutStart = Math.max(0, total - edl.audio.fadeOut);
  if (music) graph.push(`[${musicInput}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${num(total)},asetpts=PTS-STARTPTS,volume=${num(edl.audio.musicGain)}[mus]`);
  let mixed: string;
  if (edl.audio.mode === "mix") {
    if (edl.audio.duck) graph.push(`[${audio}]asplit=2[speech][key]`, `[mus][key]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=400:makeup=1[ducked]`, `[speech][ducked]amix=inputs=2:duration=first:normalize=0[mixed]`);
    else graph.push(`[${audio}][mus]amix=inputs=2:duration=first:normalize=0[mixed]`);
    mixed = "mixed";
  } else if (edl.audio.mode === "soundtrack") { graph.push(`[${audio}]anullsink`); mixed = "mus"; } else mixed = audio;
  const master = edl.audio.mode === "muted"
    ? `[${mixed}]atrim=duration=${num(total)}[aout]`
    : `[${mixed}]atrim=duration=${num(total)},afade=t=in:d=${num(edl.audio.fadeIn)},afade=t=out:st=${num(fadeOutStart)}:d=${num(edl.audio.fadeOut)},loudnorm=I=${edl.audio.loudness}:TP=-1.5:LRA=11,aresample=48000,alimiter=limit=0.89:level=false[aout]`;
  graph.push(master);

  const threads = String(context.threads ?? 4);
  const encoder = context.encoder ?? "libx264";
  const videoCodec = encoder === "h264_amf"
    ? ["-c:v", "h264_amf", "-quality", quality ? "quality" : "speed", "-rc", "cqp", "-qp_i", quality ? "18" : "21", "-qp_p", quality ? "20" : "23", "-bf", "0"]
    : ["-c:v", "libx264", "-preset", quality ? "medium" : "veryfast", "-crf", quality ? "18" : "21", "-profile:v", "high", "-threads", threads];
  args.push("-filter_complex", graph.join(";"), "-filter_complex_threads", threads,
    "-map", "[vout]", "-map", "[aout]", ...videoCodec, "-pix_fmt", "yuv420p", "-r", String(fps), "-g", String(fps * 2), "-s", `${W}x${H}`,
    "-c:a", "aac", "-b:a", quality ? "192k" : "160k", "-ar", "48000", "-ac", "2", "-t", num(total), "-movflags", "+faststart", context.output,
    "-map", "[cover]", "-fps_mode", "vfr", "-frames:v", "3", "-q:v", "2", path.normalize(context.coverPattern));
  return args;
}
