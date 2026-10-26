import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { SOUNDTRACKS } from "../src/lib/creative/music";
import { ffmpeg, runProcess } from "../src/lib/video/process";

/** Original mathematical synthesis. No downloaded samples, songs, or licensed loops. */
async function main() {
  await mkdir("public/audio", { recursive: true }); await mkdir("data", { recursive: true });
  for (const track of SOUNDTRACKS) {
    const rate = 48000, length = rate * track.duration;
    const pcm = Buffer.alloc(length * 2); const beat = 60 / track.bpm;
    const notes = track.id === "pulse" ? [130.81, 164.81, 196, 164.81] : [110, 130.81, 164.81, 146.83];
    let seed = 42;
    for (let index = 0; index < length; index++) {
      const time = index / rate, phase = time % beat, step = Math.floor(time / beat);
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const kick = Math.sin(2 * Math.PI * (48 * phase + 2 * (1 - Math.exp(-40 * phase)))) * Math.exp(-phase * 24) * 0.5;
      const hat = (seed / 0xffffffff * 2 - 1) * Math.exp(-(time % (beat / 2)) * 160) * 0.08;
      const note = notes[Math.floor(step / 2) % notes.length];
      const synth = (Math.sin(2 * Math.PI * note * time) + 0.3 * Math.sin(2 * Math.PI * note * 2 * time)) * Math.exp(-phase * 5) * 0.17;
      const edge = Math.min(1, time / 0.01, (track.duration - time) / 0.2);
      pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, (kick + hat + synth) * edge)) * 28000), index * 2);
    }
    const raw = path.resolve(`data/${track.id}-synth.pcm`);
    await writeFile(raw, pcm);
    await runProcess(ffmpeg(), ["-y", "-f", "s16le", "-ar", String(rate), "-ac", "1", "-i", raw, "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", path.resolve(`public/audio/${track.id}.m4a`)], "Original soundtrack encoding");
    await rm(raw); console.log(`${track.name}: ${track.bpm} BPM, ${track.duration}s, public/audio/${track.id}.m4a`);
  }
}
void main();
