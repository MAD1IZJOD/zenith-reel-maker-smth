import type { EditDecisionList } from "@/lib/edit/edl";
import type { CaptionStyleId, TitleStyle } from "@/lib/edit/styles";

/**
 * Advanced SubStation (libass) typography for titles, cards and word-timed captions.
 * Layout constants are fractions of the 9:16 canvas so 720p and 1080p exports compose identically.
 * Social app chrome covers roughly the top 10%, bottom 20% and right 14%; nothing is placed there.
 */
export const SAFE = { top: 0.1, bottom: 0.22, side: 0.08 } as const;
/** Title-card captions relative to running speech captions (libass sizes by full line height, so cards read small otherwise). */
const CARD_SCALE = 1.3;
const num = (value: number) => String(Math.round(value * 100) / 100);

type Font = { family: string; bold: 0 | 1; width: number; upper?: boolean };
const FONTS = {
  poppinsBold: { family: "Poppins", bold: 1, width: 0.44 },
  poppinsExtra: { family: "Poppins ExtraBold", bold: 0, width: 0.46 },
  poppinsSemi: { family: "Poppins SemiBold", bold: 0, width: 0.42 },
  anton: { family: "Anton", bold: 0, width: 0.36, upper: true },
  serif: { family: "DM Serif Display", bold: 0, width: 0.44 },
  bebas: { family: "Bebas Neue", bold: 0, width: 0.41, upper: true },
  vt: { family: "VT323", bold: 0, width: 0.5, upper: true },
} satisfies Record<string, Font>;

export type CaptionLook = { font: Font; size: number; primary: string; highlight: string; outline: number; shadow: number; back: string; box: boolean; spacing: number; lineChars: number; align: "center" | "left"; bottom: number; pop: boolean };
/** Sizes are for a 1080-wide canvas; colours are ASS &HAABBGGRR. */
export const CAPTION_LOOKS: Record<CaptionStyleId, CaptionLook> = {
  "clean-creator": { font: FONTS.poppinsExtra, size: 118, primary: "&H00FFFFFF", highlight: "&H006DF4C4", outline: 5, shadow: 2, back: "&H8C000000", box: false, spacing: 0, lineChars: 15, align: "center", bottom: 0.25, pop: true },
  cinematic: { font: FONTS.serif, size: 126, primary: "&H00F2F2F2", highlight: "&H0090D8F5", outline: 2, shadow: 3, back: "&H96000000", box: false, spacing: 2, lineChars: 18, align: "center", bottom: 0.25, pop: false },
  "high-energy": { font: FONTS.anton, size: 150, primary: "&H00FFFFFF", highlight: "&H003BD4FF", outline: 6, shadow: 3, back: "&H80000000", box: false, spacing: 1, lineChars: 13, align: "center", bottom: 0.27, pop: true },
  minimal: { font: FONTS.poppinsSemi, size: 74, primary: "&H00FFFFFF", highlight: "&H006DF4C4", outline: 0, shadow: 0, back: "&H5C101010", box: true, spacing: 0.5, lineChars: 24, align: "left", bottom: 0.24, pop: false },
  "podcast-pop": { font: FONTS.poppinsBold, size: 104, primary: "&H00FFFFFF", highlight: "&H003BD4FF", outline: 14, shadow: 0, back: "&H38000000", box: true, spacing: 0, lineChars: 16, align: "center", bottom: 0.25, pop: true },
};

const TITLE_LOOKS: Record<TitleStyle, { font: Font; size: number; y: number; align: "center" | "left" }> = {
  editorial: { font: FONTS.serif, size: 150, y: 0.17, align: "center" },
  poster: { font: FONTS.anton, size: 160, y: 0.16, align: "center" },
  compact: { font: FONTS.poppinsSemi, size: 104, y: 0.13, align: "left" },
};

export function assTime(seconds: number): string {
  const centis = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(centis / 360000), m = Math.floor(centis / 6000) % 60, s = Math.floor(centis / 100) % 60, c = centis % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}
/** Literal text only: braces and backslashes are already removed by EDL validation; strip again defensively. */
export const assText = (value: string) => value.replace(/[{}\\]/g, "").replace(/\s+/g, " ").trim();

/** Balanced two-line wrap. Words longer than a line remain whole and are scaled down instead of split. */
export function wrapWords(words: string[], lineChars: number): string[][] {
  const total = words.join(" ").length;
  if (total <= lineChars || words.length < 2) return [words];
  let best: { split: number; score: number } = { split: 1, score: Infinity };
  for (let split = 1; split < words.length; split++) {
    const a = words.slice(0, split).join(" ").length, b = words.slice(split).join(" ").length;
    const score = Math.max(a, b) + (a > lineChars || b > lineChars ? 100 : 0) + (b > a ? 0.5 : 0);
    if (score < best.score) best = { split, score };
  }
  return [words.slice(0, best.split), words.slice(best.split)];
}

/** Horizontal scale (percent) that keeps the widest line inside the safe width. */
export function fitScale(lines: string[], font: Font, size: number, canvasWidth: number, box: boolean): number {
  const available = canvasWidth * (1 - SAFE.side * 2) - (box ? size * 0.6 : 0);
  const widest = Math.max(...lines.map((line) => [...line].length * size * font.width));
  return widest <= available ? 100 : Math.max(55, Math.floor((available / widest) * 100));
}

function style(name: string, font: Font, size: number, primary: string, secondary: string, outlineColour: string, back: string, borderStyle: 1 | 3, outline: number, shadow: number, alignment: number, marginL: number, marginR: number, marginV: number, spacing: number) {
  return `Style: ${name},${font.family},${Math.round(size)},${primary},${secondary},${outlineColour},${back},${font.bold ? -1 : 0},0,0,0,100,100,${spacing},0,${borderStyle},${outline},${shadow},${alignment},${Math.round(marginL)},${Math.round(marginR)},${Math.round(marginV)},1`;
}

export function buildAss(edl: EditDecisionList, mode: "video" | "cover"): string {
  const { width, height } = edl.canvas;
  const k = width / 1080;
  const side = width * SAFE.side;
  const look = CAPTION_LOOKS[edl.captionStyle];
  const title = TITLE_LOOKS[edl.titleStyle];
  // Faceless layouts have no subject to protect, so centred captions are set larger for phone-distance reading.
  const captionSize = look.size * k * (edl.captionPosition === "center" ? 1.3 : 1), titleSize = title.size * k;
  // Faceless layouts have no subject to avoid, so captions sit at the visual centre; video keeps them low.
  const centered = edl.captionPosition === "center";
  const captionAlign = centered ? (look.align === "left" ? 4 : 5) : look.align === "left" ? 1 : 2;
  const titleAlign = title.align === "left" ? 7 : 8;
  const lines: string[] = [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${width}`, `PlayResY: ${height}`, "WrapStyle: 2", "ScaledBorderAndShadow: yes", "YCbCr Matrix: TV.709", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    style("Caption", look.font, captionSize, look.primary, look.highlight, look.box ? look.back : "&H00000000", look.back, look.box ? 3 : 1, (look.box ? look.outline || 14 : look.outline) * k, look.shadow * k, captionAlign, side, side, centered ? 0 : height * look.bottom, look.spacing * k),
    style("Title", title.font, titleSize, "&H00FFFFFF", "&H00FFFFFF", "&H50000000", "&H8C000000", 1, 3 * k, 3 * k, titleAlign, side, side, height * title.y, edl.titleStyle === "poster" ? 2 * k : 0),
    style("Badge", FONTS.vt, 84 * k, "&H00E8F4FF", "&H00E8F4FF", "&H64000000", "&H00000000", 1, 1.5 * k, 0, 7, side, side, height * 0.075, 2 * k),
    style("Headline", title.font, titleSize * 0.56, "&H00FFFFFF", "&H00FFFFFF", "&H50000000", "&H8C000000", 1, 2 * k, 2 * k, 8, side, side, height * 0.1, edl.titleStyle === "poster" ? 1.5 * k : 0),
    style("Backdrop", FONTS.anton, 250 * k, "&HE6FFFFFF", "&HE6FFFFFF", "&HFF000000", "&HFF000000", 1, 0, 0, 5, 0, 0, 0, 4 * k),
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const event = (layer: number, start: number, end: number, styleName: string, body: string) => lines.push(`Dialogue: ${layer},${assTime(start)},${assTime(end)},${styleName},,0,0,0,,${body}`);
  const titleText = (value: string) => (title.font.upper ? assText(value).toUpperCase() : assText(value));

  if (mode === "cover") {
    // A soft dark band in the lower third keeps the cover title legible without covering the subject's face.
    const coverLines = wrapWords(titleText(edl.cover.title).split(" "), 14).map((line) => line.join(" "));
    const size = titleSize * 1.1;
    const scale = fitScale(coverLines, title.font, size, width, false);
    const top = Math.round(height * 0.6), bottom = Math.round(height * 0.86);
    event(0, 0, 3600, "Title", `{\\an7\\pos(0,0)\\bord0\\shad0\\blur${Math.round(40 * k)}\\1c&H000000&\\1a&H3C&\\p1}m 0 ${top} l ${width} ${top} ${width} ${bottom} 0 ${bottom}{\\p0}`);
    event(1, 0, 3600, "Title", `{\\an2\\pos(${width / 2},${Math.round(height * 0.79)})\\fs${Math.round(size)}\\fscx${scale}\\fscy${scale}}${coverLines.join("\\N")}`);
    return `${lines.join("\n")}\n`;
  }

  for (const overlay of edl.overlays) {
    const duration = overlay.end - overlay.start;
    const fadeIn = Math.min(220, Math.round(duration * 250)), fadeOut = Math.min(260, Math.round(duration * 250));
    if (overlay.role === "headline") {
      // Persistent reel title: the speaker's own words, small enough to stay out of the captions' way.
      const words = titleText(overlay.text).split(" ");
      const wrapped = wrapWords(words, title.align === "left" ? 26 : 20).map((line) => line.join(" "));
      const scale = fitScale(wrapped, title.font, titleSize * 0.56, width, false);
      event(1, overlay.start, overlay.end, "Headline", `{\\fad(${fadeIn},${fadeOut})\\fscx${scale}\\fscy${scale}}${wrapped.join("\\N")}`);
      continue;
    }
    if (overlay.role === "backdrop") {
      // Motion-graphic fallback: a spoken keyword drifting huge and faint behind the captions. Purely decorative.
      const index = edl.overlays.filter((item) => item.role === "backdrop").indexOf(overlay);
      const y = Math.round(height * (index % 2 ? 0.32 : 0.62)), drift = Math.round(width * 0.12);
      const scale = fitScale([assText(overlay.text).toUpperCase()], FONTS.anton, 250 * k, width * 1.25, false);
      event(0, overlay.start, overlay.end, "Backdrop", `{\\an5\\fad(500,500)\\fscx${scale}\\fscy${scale}\\move(${width / 2 + drift},${y},${width / 2 - drift},${y})}${assText(overlay.text).toUpperCase()}`);
      continue;
    }
    if (overlay.role === "badge") { event(2, overlay.start, overlay.end, "Badge", `{\\c&H003C3CF0&}●{\\c&H00E8F4FF&} ${assText(overlay.text)}`); continue; }
    if (overlay.role === "card") {
      // Cards hold one to three words, so they are set larger than running speech captions and given a heavier,
      // softened outline that stays readable over bright footage; fitScale still keeps every line inside the safe width.
      const cardSize = captionSize * CARD_SCALE;
      const words = assText(overlay.text).split(" ");
      const wrapped = wrapWords(look.font.upper ? words.map((word) => word.toUpperCase()) : words, Math.max(8, Math.round(look.lineChars / CARD_SCALE))).map((line) => line.join(" "));
      const scale = fitScale(wrapped, look.font, cardSize, width, look.box);
      const pop = look.pop ? `\\fscx${Math.round(scale * 0.86)}\\fscy${Math.round(scale * 0.86)}\\t(0,140,\\fscx${scale}\\fscy${scale})` : `\\fscx${scale}\\fscy${scale}`;
      const edge = look.box ? "" : `\\bord${num(Math.max(look.outline, 3) * k * CARD_SCALE * 1.2)}\\blur${num(1.5 * k)}`;
      event(1, overlay.start, overlay.end, "Caption", `{\\fs${Math.round(cardSize)}${edge}\\fad(${fadeIn},${fadeOut})${pop}}${wrapped.join("\\N")}`);
      continue;
    }
    // Hook and closing titles rise gently into place.
    const words = titleText(overlay.text).split(" ");
    const wrapped = wrapWords(words, title.align === "left" ? 22 : 14).map((line) => line.join(" "));
    const size = overlay.role === "closing" ? titleSize * 0.92 : titleSize;
    const scale = fitScale(wrapped, title.font, size, width, false);
    const x = title.align === "left" ? side : width / 2, y = height * title.y;
    const rise = Math.round(26 * k);
    event(1, overlay.start, overlay.end, "Title", `{\\an${titleAlign}\\fs${Math.round(size)}\\fscx${scale}\\fscy${scale}\\fad(${fadeIn},${fadeOut})\\move(${Math.round(x)},${Math.round(y + rise)},${Math.round(x)},${Math.round(y)},0,${Math.min(420, fadeIn * 2)})}${wrapped.join("\\N")}`);
  }

  // Word-timed captions: one event per word slice, the spoken word highlighted. Times come only from the transcript.
  for (const group of edl.captions) {
    const words = group.words.map((word) => (look.font.upper ? assText(word.text).toUpperCase() : assText(word.text)));
    const wrapped = wrapWords(words, look.lineChars);
    const scale = fitScale(wrapped.map((line) => line.join(" ")), look.font, captionSize, width, look.box);
    group.words.forEach((word, index) => {
      const start = index === 0 ? group.start : word.start;
      const end = index === group.words.length - 1 ? group.end : group.words[index + 1].start;
      if (end - start < 0.01) return;
      let cursor = 0;
      const body = wrapped.map((line) => line.map((value) => { const current = cursor++ === index; return current ? `{\\c${look.highlight}&}${value}{\\c${look.primary}&}` : value; }).join(" ")).join("\\N");
      const pop = look.pop && index === 0 ? `\\fscx${Math.round(scale * 0.9)}\\fscy${Math.round(scale * 0.9)}\\t(0,110,\\fscx${scale}\\fscy${scale})` : `\\fscx${scale}\\fscy${scale}`;
      event(1, start, end, "Caption", `{${pop}}${body}`);
    });
  }
  return `${lines.join("\n")}\n`;
}
