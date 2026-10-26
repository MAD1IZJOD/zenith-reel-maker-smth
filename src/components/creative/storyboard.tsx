"use client";
import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ArrowRight, Check, Film } from "lucide-react";
import type { StudioShot } from "@/types/studio";
import type { StudioAssist } from "@/lib/ai/studio";
import type { ShotOrder } from "@/lib/creative/options";

gsap.registerPlugin(useGSAP);

export default function Storyboard({ shots, order, guides, active, onSelect, onCapture, compact = false }: {
  shots: (StudioShot | undefined)[]; order: ShotOrder; guides: StudioAssist["director"];
  active: number; onSelect: (index: number) => void; onCapture?: (index: number) => void; compact?: boolean;
}) {
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference) and (min-width: 721px)", () => {
      const frames = scope.current?.querySelectorAll<HTMLElement>(".story-frame");
      frames?.forEach((frame, index) => gsap.to(frame, { z: order[index] === active ? 42 : 0, rotateY: (index - 1) * -8, y: order[index] === active ? -8 : 0, duration: 0.35, ease: "power2.out" }));
    });
    return () => media.revert();
  }, { scope, dependencies: [active, order.join(",")], revertOnUpdate: true });
  return <div ref={scope} className={`storyboard ${compact ? "compact-board" : ""}`} data-renderer="css-3d" aria-label="Three-shot storyboard">
    <div className="storyboard-heading"><span className="eyebrow">YOUR STORYBOARD</span><span>{shots.filter(Boolean).length}/3 captured</span></div>
    <div className="story-stage" role="group" aria-label="Choose a storyboard shot">
      {order.map((shotIndex, position) => <button type="button" key={shotIndex} className={`story-frame ${active === shotIndex ? "selected" : ""}`} aria-pressed={active === shotIndex} onClick={() => onSelect(shotIndex)} aria-label={`Storyboard position ${position + 1}, shot ${shotIndex + 1}${shots[shotIndex] ? ", complete" : ", ready"}`}>
        <span className="frame-top"><b>0{position + 1}</b>{shots[shotIndex] ? <Check size={16} /> : <Film size={16} />}</span>
        {shots[shotIndex] ? <video key={shots[shotIndex]?.previewUrl} src={shots[shotIndex]?.previewUrl} muted playsInline preload="metadata" /> : <span className="frame-placeholder"><span className="viewfinder" /><b>{["OPENING", "ACTION", "PAYOFF"][position]}</b></span>}
        <span className="frame-caption">{guides[shotIndex].title.replace(/^Shot \d: /, "")}</span>
      </button>)}
    </div>
    <div className="story-detail" aria-live="polite"><div><p className="eyebrow">SHOT {active + 1} · {shots[active] ? "CAPTURED" : "READY"}</p><h3>{guides[active].title.replace(/^Shot \d: /, "")}</h3><p>{guides[active].direction}</p></div>{onCapture && <button className="secondary" onClick={() => onCapture(active)}>{shots[active] ? "Review this shot" : "Capture this shot"}<ArrowRight size={16} /></button>}</div>
  </div>;
}
