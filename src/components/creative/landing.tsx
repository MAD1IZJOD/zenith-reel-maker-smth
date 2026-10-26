"use client";
import { useRef, useState } from "react";
import { ArrowUpRight, Film, Play } from "lucide-react";
import { useStudioMotion } from "@/hooks/use-studio-motion";

export function Landing({ festival, onCreate, onDemo, onBattle }: { festival: boolean; onCreate: () => void; onDemo: () => void; onBattle: () => void }) {
  const scope = useStudioMotion("landing");
  const [active, setActive] = useState(1);
  const player = useRef<HTMLVideoElement>(null);
  return <div ref={scope} className="cinema-landing">
    <section className="hero-copy"><p className="eyebrow" data-reveal>ZENITH AGENTIC REEL MAKER · IDEAS 4.0</p><h1 data-reveal>{festival ? <>3 Shots.<br /><em>1 Epic Reel.</em></> : <>Three shots.<br /><em>Infinite stories.</em></>}</h1><p className="hero-tagline" data-reveal>Your AI film crew. Your story.</p><p className="lede" data-reveal>Record three moments. Direct five creative agents. Make something worth sharing.</p><div className="actions" data-reveal><button className="primary" onClick={onCreate}>{festival ? "Start Creating" : "Create your reel"}<ArrowUpRight size={18} /></button><button className="secondary" onClick={onDemo}>{festival ? "Try Demo" : "Explore the studio"}<Play size={16} /></button>{festival && <button className="text-action" onClick={onBattle}>Reel Battle · Surprise Me</button>}</div><p className="privacy" data-reveal>No account. Your footage stays private. Creative guidance works without a paid AI service.</p></section>
    <section className="hero-installation" aria-label="Explore the three-shot sample sequence" data-reveal>
      <div className="installation-label"><span>STORY STUDY / 001</span><span>9:16 · THREE MOMENTS</span></div>
      <div className="hero-panels">{[0, 1, 2].map((index) => <button key={index} className={`hero-panel ${active === index ? "selected" : ""}`} onClick={() => setActive(index)} aria-pressed={active === index} aria-label={`Explore sample shot ${index + 1}`}><span className="frame-top">0{index + 1}<Film size={15} /></span><video key={`${index}-${active === index}`} ref={active === index ? player : undefined} src={`/samples/shot-${index + 1}.mp4`} muted playsInline preload="metadata" /><span className="hero-panel-label">{["THE ENTRANCE", "THE DETAIL", "THE REVEAL"][index]}</span></button>)}</div>
      <div className="installation-footer"><span>Original synthetic demo footage</span><button className="text-action" onClick={() => { if (player.current?.paused) void player.current.play().catch(() => undefined); else player.current?.pause(); }}><Play size={13} /> Play / pause selected shot</button></div>
    </section>
    <section className="workflow-strip" aria-label="How it works"><div><b>01</b><span>Choose the feeling<small>Seven distinct editing styles</small></span></div><div><b>02</b><span>Capture three moments<small>Camera, uploads, or samples</small></span></div><div><b>03</b><span>Make the final cut<small>A real MP4. Yours to keep.</small></span></div></section>
    <footer className="landing-footer"><span>ZENITH REEL <span className="muted">/ Your personal creative crew</span></span><nav><a href="/festival">Festival mode</a><a href="/privacy">Privacy & permissions</a></nav></footer>
  </div>;
}
