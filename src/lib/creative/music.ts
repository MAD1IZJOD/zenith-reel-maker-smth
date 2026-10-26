export const SOUNDTRACKS = [
  { id: "pulse", name: "Neon Steps", bpm: 120, duration: 24, url: "/audio/pulse.m4a", description: "A crisp original synth pulse. 120 BPM." },
  { id: "drift", name: "After Hours", bpm: 90, duration: 24, url: "/audio/drift.m4a", description: "A slower original synth atmosphere. 90 BPM." },
] as const;
export type MusicId = typeof SOUNDTRACKS[number]["id"];
export const getSoundtrack = (id: string) => SOUNDTRACKS.find((track) => track.id === id);
