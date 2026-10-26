"use client";
import { useEffect, useRef, useState } from "react";
import { SOUNDTRACKS, getSoundtrack } from "@/lib/creative/music";
import { createTimeline, SYNC_MODES } from "@/lib/creative/timeline";
import type { CreativeOptions } from "@/lib/creative/options";
import type { ReelPreset } from "@/lib/presets";
import type { StudioShot } from "@/types/studio";

export function BeatLab({ preset, options, onChange, shots }: { preset: ReelPreset; options: CreativeOptions; onChange: (options: CreativeOptions) => void; shots: (StudioShot | undefined)[] }) {
  const timeline = createTimeline(preset, options);
  const [cursor, setCursor] = useState(0);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [audioError, setAudioError] = useState<string>();
  const audio = useRef<HTMLAudioElement>(null);
  const track = getSoundtrack(options.musicId)!;
  const segment = cursor >= timeline.cutPositions[1] ? 2 : cursor >= timeline.cutPositions[0] ? 1 : 0;
  const sourceShot = options.shotOrder[segment];
  // Decode this bundled soundtrack only. Release the AudioContext and fetch on navigation.
  useEffect(() => {
    setCursor(0); setWaveform([]); setAudioError(undefined);
    if (options.audioMode !== "soundtrack") return;
    const controller = new AbortController(); let context: AudioContext | undefined; let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(track.url, { signal: controller.signal }); if (!response.ok) throw new Error();
        context = new AudioContext(); const buffer = await context.decodeAudioData(await response.arrayBuffer());
        const samples = buffer.getChannelData(0), bins = 100, stride = Math.floor(samples.length / bins);
        const peaks = Array.from({ length: bins }, (_, bin) => { let peak = 0; for (let index = bin * stride; index < (bin + 1) * stride; index += 16) peak = Math.max(peak, Math.abs(samples[index])); return peak; });
        if (!cancelled) setWaveform(peaks);
      } catch { if (!cancelled) setAudioError("Waveform unavailable. You can still preview the track and use its defined beat grid."); }
      finally { if (context && context.state !== "closed") await context.close().catch(() => undefined); }
    })();
    return () => { cancelled = true; controller.abort(); if (context && context.state !== "closed") void context.close().catch(() => undefined); };
  }, [track.url, options.audioMode]);
  return <section className="beat-lab" aria-label="Beat Lab"><p className="eyebrow">BEAT LAB</p><h3>Find your rhythm.</h3><p className="privacy">The timing below becomes your exported edit. Crossfades begin at the marked cuts.</p>
    <label className="field-label">Audio source<select value={options.audioMode} onChange={(event) => onChange({ ...options, audioMode: event.target.value as CreativeOptions["audioMode"] })}><option value="muted">Silent reel</option><option value="original">Original clip audio</option><option value="soundtrack">Original studio soundtrack</option></select></label>
    {options.audioMode === "soundtrack" && <><label className="field-label">Soundtrack<select value={options.musicId} onChange={(event) => onChange({ ...options, musicId: event.target.value as CreativeOptions["musicId"], syncMode: options.syncMode === "preset" ? "auto" : options.syncMode })}>{SOUNDTRACKS.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.bpm} BPM</option>)}</select></label><audio ref={audio} key={track.id} controls preload="metadata" src={track.url} onError={() => setAudioError("This soundtrack could not load. Choose another track, original audio, or a silent reel.")} onTimeUpdate={(event) => { const value = event.currentTarget.currentTime; if (value >= timeline.totalDuration) { event.currentTarget.pause(); event.currentTarget.currentTime = 0; setCursor(0); } else setCursor(value); }} /><p className="privacy">Original composition · {track.bpm} BPM · defined grid, no AI beat detection.</p></>}
    <label className="field-label">Sync mode<select value={options.syncMode} onChange={(event) => onChange({ ...options, syncMode: event.target.value as CreativeOptions["syncMode"] })}>{SYNC_MODES.map((mode) => <option key={mode} value={mode}>{mode === "preset" ? "Preset rhythm" : mode === "auto" ? "Auto · four beats per shot" : mode === "energetic" ? "Energetic · two beats per shot" : mode === "cinematic" ? "Cinematic · eight beats per shot" : "Custom timing"}</option>)}</select></label>
    {options.syncMode === "custom" && <div className="timing-fields">{options.customSeconds.map((seconds, index) => <label className="field-label" key={index}>Segment {index + 1} seconds<input type="number" min="1" max="6" step="0.5" value={seconds} onChange={(event) => { const next = [...options.customSeconds] as [number, number, number]; next[index] = Math.min(6, Math.max(1, Number(event.target.value) || 1)); onChange({ ...options, customSeconds: next }); }} /></label>)}</div>}
    <div className="beat-ruler" aria-label={`Edit duration ${timeline.totalDuration.toFixed(1)} seconds. Cuts at ${timeline.cutPositions.map((time) => time.toFixed(1)).join(" and ")} seconds`}>
      {options.audioMode === "soundtrack" && waveform.length > 0 && <svg className="waveform" viewBox="0 0 100 36" preserveAspectRatio="none" aria-label="Measured soundtrack amplitude">{waveform.slice(0, Math.ceil(timeline.totalDuration / track.duration * waveform.length)).map((value, index, items) => <line key={index} x1={index / items.length * 100} x2={index / items.length * 100} y1={18 - value * 17} y2={18 + value * 17} stroke="currentColor" strokeWidth="0.6" />)}</svg>}
      {options.audioMode === "soundtrack" && timeline.beats.map((time, index) => <i className={index % 4 === 0 ? "beat major" : "beat"} key={time} style={{ left: `${time / timeline.totalDuration * 100}%` }} />)}
      {timeline.cutPositions.map((time, index) => <span className="cut-marker" key={index} style={{ left: `${time / timeline.totalDuration * 100}%` }}>{time.toFixed(1)}s</span>)}<span className="time-cursor" style={{ left: `${cursor / timeline.totalDuration * 100}%` }} />
    </div><div className="timeline-segments">{options.shotOrder.map((shot, index) => { const bounds = [0, ...timeline.cutPositions, timeline.totalDuration]; return <button className={segment === index ? "selected" : ""} style={{ flex: bounds[index + 1] - bounds[index] }} key={shot} onClick={() => { const time = bounds[index]; setCursor(time); if (audio.current) audio.current.currentTime = time; }}>Shot {shot + 1}<small>{(bounds[index + 1] - bounds[index]).toFixed(1)}s</small></button>; })}</div>
    <label className="field-label">Preview sequence · {cursor.toFixed(1)} / {timeline.totalDuration.toFixed(1)} sec<input type="range" min="0" max={timeline.totalDuration} step="0.1" value={cursor} onChange={(event) => { const time = Number(event.target.value); setCursor(time); if (audio.current) audio.current.currentTime = time; }} /></label>
    {shots[sourceShot] && <div className="sequence-inspector"><video key={shots[sourceShot]?.previewUrl} src={shots[sourceShot]?.previewUrl} controls muted playsInline preload="metadata" /><p>At {cursor.toFixed(1)}s: recorded shot {sourceShot + 1}.<small>This is source footage. Generate the reel to review the final cuts and effects.</small></p></div>}{audioError && <p className="privacy" role="status">{audioError}</p>}
  </section>;
}
