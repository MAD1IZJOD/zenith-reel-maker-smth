import path from "node:path";
import { MEDIA_INPUT_OPTIONS } from "./input-policy";
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
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  let chain: string;
  if (segment.crop === "fit-blur") {
    const aspect = source.width! / source.height!;
    const fgHeight = Math.min(H, Math.max(Math.round(W / aspect), Math.round(H * segment.fitHeight)));
    const bgW = even(W / 8), bgH = even(H / 8);
    chain = `split=2[${label}b][${label}f];[${label}b]scale=${bgW}:${bgH}:force_original_aspect_ratio=increase,crop=${bgW}:${bgH},boxblur=5:2,scale=${W}:${H}:flags=bicubic,eq=brightness=-0.08:saturation=0.78[${label}bg];[${label}f]scale=-2:${even(fgHeight)}:flags=${flags},crop='min(iw,${W})':ih:(iw-ow)*${num(segment.focusX)}:0[${label}fg];[${label}bg][${label}fg]overlay=(W-w)/2:(H-h)/2`;
  } else if (segment.crop === "abstract") {
    // Faceless: the footage reduced to a 1/16-scale, heavily blurred colour field. No person is recognisable.
    const smallW = even(W / 16), smallH = even(H / 16);
    chain = `scale=${smallW}:${smallH}:force_original_aspect_ratio=increase,crop=${smallW}:${smallH},boxblur=4:3,eq=brightness=-0.08:saturation=0.7,${backgroundLook(edl)},scale=${W}:${H}:flags=bicubic`;
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

/** Grade (without grain) and, for Cinematic, a vignette: applied to smooth faceless backgrounds before upscaling. */
function backgroundLook(edl: EditDecisionList): string {
  return [gradeFilter(edl.grade, false).replace(/,noise=[^,]+/g, ""), edl.composition === "cinematic" ? "vignette=PI/4.5" : ""].filter(Boolean).join(",");
}

/** Original, slowly moving gradient backgrounds for faceless compositions (no third-party imagery). */
const GRADIENTS: Record<Exclude<EditDecisionList["composition"], "video">, string> = {
  minimal: "c0=0x1A2030:c1=0x2A3550:c2=0x141821:nb_colors=3:speed=0.006:seed=11",
  cinematic: "c0=0x30231A:c1=0x56402C:c2=0x1A3034:nb_colors=3:speed=0.005:seed=23",
  broll: "c0=0x2A2258:c1=0x164C52:c2=0x3A2050:c3=0x1A1A34:nb_colors=4:speed=0.012:seed=5",
};

export function compileEdl(edl: EditDecisionList, context: CompileContext): string[] {
  const quality = edl.profile === "quality";
  const total = edlDuration(edl);
  const { width: W, height: H, fps } = edl.canvas;
  const args: string[] = ["-y", "-v", "error", "-nostdin"];
  const graph: string[] = [];
  const framesFromSource = edl.composition === "video" || (edl.composition === "cinematic" && edl.segments.every((segment) => segment.crop === "abstract"));

  // One input per segment, trimmed at the demuxer so only the needed source is decoded; then b-roll; then music.
  let inputs = 0;
  edl.segments.forEach((segment) => {
    const path = context.sourcePaths[segment.source];
    if (!path) throw new Error("Edit references a missing source.");
    args.push("-ss", num(segment.start), "-t", num(sourceSeconds(segment) + 0.1), ...MEDIA_INPUT_OPTIONS, "-i", path); inputs++;
  });
  const brollInputs = edl.composition === "broll" ? edl.broll.map((piece) => {
    const path = context.sourcePaths[piece.source];
    if (!path) throw new Error("B-roll references a missing source.");
    args.push("-ss", num(piece.start), "-t", num(piece.duration + 0.1), ...MEDIA_INPUT_OPTIONS, "-i", path);
    return inputs++;
  }) : [];
  const music = edl.audio.mode === "soundtrack" || edl.audio.mode === "mix";
  if (music) {
    if (!context.musicPath) throw new Error("Soundtrack unavailable.");
    args.push("-stream_loop", "-1", "-i", context.musicPath);
  }
  const musicInput = inputs;
  const useOriginal = edl.audio.mode === "original" || edl.audio.mode === "mix";

  edl.segments.forEach((segment, index) => {
    const D = num(segment.duration);
    if (framesFromSource) graph.push(`[${index}:v]setpts=(PTS-STARTPTS)/${num(segment.speed)},fps=${fps},${framing(edl, segment, index, quality)},setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=${D},trim=duration=${D},setpts=PTS-STARTPTS,settb=AVTB[v${index}]`);
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
      if (framesFromSource) graph.push(`[${video}][v${next}]concat=n=2:v=1:a=0,settb=AVTB[${outV}]`);
      graph.push(`[${audio}][a${next}]concat=n=2:v=0:a=1[${outA}]`);
    } else {
      if (framesFromSource) graph.push(`[${video}][v${next}]xfade=transition=${XFADE[transition.type]}:duration=${num(transition.duration)}:offset=${num(length - transition.duration)}[${outV}]`);
      graph.push(`[${audio}][a${next}]acrossfade=d=${num(transition.duration)}:c1=tri:c2=tri[${outA}]`);
    }
    length += edl.segments[next].duration - transition.duration;
    video = outV; audio = outA;
  });

  if (!framesFromSource) {
    if (brollInputs.length) {
      // The visitor's own b-roll, framed to fill the screen, softened so captions stay readable, dissolving between clips.
      brollInputs.forEach((input, index) => {
        const piece = edl.broll[index];
        graph.push(`[${input}:v]setpts=PTS-STARTPTS,fps=${fps},scale=${W}:${H}:force_original_aspect_ratio=increase:flags=bicubic,crop=${W}:${H},eq=brightness=-0.1:saturation=0.92,setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=${num(piece.duration)},trim=duration=${num(piece.duration)},setpts=PTS-STARTPTS,settb=AVTB[r${index}]`);
      });
      video = "r0";
      let offset = edl.broll[0].duration;
      for (let index = 1; index < brollInputs.length; index++) {
        graph.push(`[${video}][r${index}]xfade=transition=fade:duration=0.4:offset=${num(offset - 0.4)}[rj${index}]`);
        video = `rj${index}`; offset += edl.broll[index].duration - 0.4;
      }
      graph.push(`[${video}]tpad=stop_mode=clone:stop_duration=${num(total)},trim=duration=${num(total)},setpts=PTS-STARTPTS[bg]`);
    } else {
      // Smooth backgrounds are generated, graded and vignetted at quarter resolution, then scaled up once. Measured on a
      // 45 s reel, full-resolution vignette and grain alone cost ~13 s; the result is visually the same. Grain is Quality-only.
      const quarterW = Math.round(W / 8) * 2, quarterH = Math.round(H / 8) * 2;
      graph.push(`gradients=s=${quarterW}x${quarterH}:r=${fps}:d=${num(total + 0.2)}:${GRADIENTS[edl.composition as keyof typeof GRADIENTS]},format=yuv420p,${backgroundLook(edl)},scale=${W}:${H}:flags=bicubic${quality ? ",noise=alls=3:allf=t" : ""},setsar=1,trim=duration=${num(total)},setpts=PTS-STARTPTS[bg]`);
    }
    video = "bg";
  }

  // Sound: original speech, licensed music ducked under it, then fades, loudness and a peak limiter.
  const fadeOutStart = Math.max(0, total - edl.audio.fadeOut);
  if (music) graph.push(`[${musicInput}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${num(total)},asetpts=PTS-STARTPTS,volume=${num(edl.audio.musicGain)}[mus]`);
  let mixed: string;
  if (edl.audio.mode === "mix") {
    if (edl.audio.duck) graph.push(`[${audio}]asplit=2[speech][key]`, `[mus][key]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=400:makeup=1[ducked]`, `[speech][ducked]amix=inputs=2:duration=first:normalize=0[mixed]`);
    else graph.push(`[${audio}][mus]amix=inputs=2:duration=first:normalize=0[mixed]`);
    mixed = "mixed";
  } else if (edl.audio.mode === "soundtrack") { graph.push(`[${audio}]anullsink`); mixed = "mus"; } else mixed = audio;
  const masterChain = edl.audio.mode === "muted"
    ? `[${mixed}]atrim=duration=${num(total)}`
    : `[${mixed}]atrim=duration=${num(total)},afade=t=in:d=${num(edl.audio.fadeIn)},afade=t=out:st=${num(fadeOutStart)}:d=${num(edl.audio.fadeOut)},loudnorm=I=${edl.audio.loudness}:TP=-1.5:LRA=11,aresample=48000,alimiter=limit=0.89:level=false`;
  graph.push(edl.waveform ? `${masterChain},asplit=2[aout][wavein]` : `${masterChain}[aout]`);

  // Look: accents, one consistent grade, texture; covers branch off before waveform, progress bar and text.
  const accents = edl.accents.map((time) => `if(between(t,${num(time)},${num(time + 0.14)}),0.3*(1-(t-${num(time)})/0.14),0)`);
  // Faceless backgrounds were already graded at low resolution; only real footage is graded at full size here.
  const smoothBackground = edl.composition !== "video" && !brollInputs.length;
  const look = smoothBackground ? "null" : [accents.length ? `eq=brightness='${accents.join("+")}':eval=frame` : "", gradeFilter(edl.grade, quality), quality ? "unsharp=5:5:0.35" : ""].filter(Boolean).join(",");
  const fonts = filterPath(context.fontsDir);
  graph.push(`[${video}]${look},split=2[graded][coverbase]`);
  let main = "graded";
  if (edl.waveform) {
    // Drawn from the reel's real audio: the waveform moves only when sound is present.
    const waveW = Math.round((W * 0.76) / 2) * 2, waveH = Math.round((H * 0.07) / 2) * 2;
    graph.push(`[wavein]showwaves=s=${waveW}x${waveH}:mode=cline:rate=${fps}:colors=0xC4F46D@0.8:scale=sqrt:draw=full,format=yuva420p[wave]`, `[${main}][wave]overlay=(W-w)/2:${Math.round(H * 0.7)}:eof_action=pass[waved]`);
    main = "waved";
  }
  if (edl.progressBar) {
    const barY = Math.round(H * 0.06), barH = Math.max(4, Math.round(H * 0.004)), barX = Math.round(W * 0.08), barW = Math.round(W * 0.84);
    graph.push(`[${main}]drawbox=x=${barX}:y=${barY}:w=${barW}:h=${barH}:color=white@0.22:t=fill,drawbox=x=${barX}:y=${barY}:w='max(1,${barW}*min(t/${num(total)},1))':h=${barH}:color=0xC4F46D@0.95:t=fill[barred]`);
    main = "barred";
  }
  graph.push(`[${main}]subtitles=filename='${filterPath(context.videoAss)}':fontsdir='${fonts}',trim=duration=${num(total)},setpts=PTS-STARTPTS[vout]`);
  const frames = edl.cover.times.map((time) => Math.max(0, Math.min(Math.round(time * fps), Math.round(total * fps) - 2)));
  graph.push(`[coverbase]select='${frames.map((frame) => `eq(n,${frame})`).join("+")}',subtitles=filename='${filterPath(context.coverAss)}':fontsdir='${fonts}'[cover]`);

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
