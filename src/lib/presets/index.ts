export type PresetId = "main-character" | "beat-sync" | "glow-up" | "plot-twist" | "retro-cam" | "squad-montage" | "movie-trailer";

export type ReelPreset = {
  id: PresetId;
  name: string;
  eyebrow: string;
  description: string;
  duration: string;
  shots: [string, string, string];
  title: string;
  captions: [string, string, string];
  effect: "cinema" | "punch" | "reveal" | "suspense" | "retro" | "party" | "trailer";
  transition: "fade" | "fadeblack" | "wipeleft" | "dissolve" | "slideleft";
  clipSeconds: number;
};

export const PRESETS: ReelPreset[] = [
  { id: "main-character", name: "Main Character Entry", eyebrow: "Cinematic", description: "A bold entrance, a close-up, then the reveal.", duration: "~8 sec", shots: ["Walk into frame", "Hold a confident close-up", "Reveal the place or the squad"], title: "MAIN CHARACTER ENERGY", captions: ["Walk in", "Own it", "That’s the moment"], effect: "cinema", transition: "fade", clipSeconds: 3 },
  { id: "beat-sync", name: "Beat Sync", eyebrow: "High energy", description: "Quick, sharp cuts built on a steady visual rhythm.", duration: "~7 sec", shots: ["One clean movement", "A quick reaction", "The biggest action"], title: "ON THE BEAT", captions: ["ONE", "TWO", "THREE"], effect: "punch", transition: "fadeblack", clipSeconds: 2.7 },
  { id: "glow-up", name: "Glow Up", eyebrow: "Transformation", description: "Build anticipation, then land a bright before-and-after reveal.", duration: "~8 sec", shots: ["The before", "Cover the lens or spin", "The after reveal"], title: "THE GLOW UP", captions: ["Before", "Wait for it…", "After"], effect: "reveal", transition: "fadeblack", clipSeconds: 3 },
  { id: "plot-twist", name: "Plot Twist", eyebrow: "Story", description: "Set it up, stretch the suspense, then switch the story.", duration: "~9 sec", shots: ["Set up the situation", "Give a suspicious look", "Deliver the twist"], title: "PLOT TWIST", captions: ["It started normally…", "Something felt off", "…until this happened"], effect: "suspense", transition: "dissolve", clipSeconds: 3.2 },
  { id: "retro-cam", name: "Retro Cam", eyebrow: "Analog", description: "Warm, grainy and nostalgic—with a proper camcorder feel.", duration: "~8 sec", shots: ["Wide memory shot", "A candid detail", "A happy closing frame"], title: "MEMORIES ON TAPE", captions: ["REC", "OCT 26", "PLAY IT BACK"], effect: "retro", transition: "wipeleft", clipSeconds: 3 },
  { id: "squad-montage", name: "Squad Montage", eyebrow: "Together", description: "Three friends, three moves, one energetic celebration.", duration: "~7 sec", shots: ["First friend enters", "Second friend joins", "Everyone celebrates"], title: "THE SQUAD’S HERE", captions: ["FIRST UP", "JOIN IN", "FULL SQUAD"], effect: "party", transition: "slideleft", clipSeconds: 2.7 },
  { id: "movie-trailer", name: "Movie Trailer", eyebrow: "Epic", description: "Slow-burn atmosphere with a final title-card reveal.", duration: "~10 sec", shots: ["An atmospheric opening", "A dramatic detail", "The hero reveal"], title: "COMING THIS FEST", captions: ["IN A WORLD…", "ONE CREW", "ONE LEGEND"], effect: "trailer", transition: "fade", clipSeconds: 3.8 },
];

export function getPreset(id: string): ReelPreset | undefined { return PRESETS.find((preset) => preset.id === id); }
