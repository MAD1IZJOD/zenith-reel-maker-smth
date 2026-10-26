import type { TypographyStyle } from "@/lib/creative/options";

export const escapeFilterPath = (value: string) => value.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
export const fontFile = () => escapeFilterPath(process.env.FFMPEG_FONT || (process.platform === "win32" ? "C:/Windows/Fonts/arialbd.ttf" : "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"));
/** Conservative single-line fit. All visitor text is read literally from files. */
export const fitText = (text: string, base: number) => Math.min(base, Math.max(16, Math.floor(630 / Math.max(1, [...text].length) / 0.7)));
export function titleOverlay(file: string, text: string, style: TypographyStyle, role: "opening" | "closing" | "cover", enable?: string) {
  const layout = style === "poster" ? { size: 62, x: "(w-text_w)/2", y: "h*0.42", box: "black@0.65" }
    : style === "compact" ? { size: 32, x: "36", y: "h*0.12", box: "black@0.5" }
      : { size: 43, x: "(w-text_w)/2", y: "h*0.10", box: "black@0.38" };
  const y = role === "cover" ? "h*0.55" : role === "closing" ? "h*0.38" : layout.y;
  return `drawtext=fontfile='${fontFile()}':textfile='${escapeFilterPath(file)}':expansion=none:fontcolor=white:fontsize=${fitText(text, layout.size)}:x=${layout.x}:y=${y}:box=1:boxcolor=${layout.box}:boxborderw=16${enable ? `:enable='${enable}'` : ""}`;
}
