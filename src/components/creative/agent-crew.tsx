"use client";
import { Check, Circle, Clapperboard, MessageSquareText, ScanLine, Type, Video } from "lucide-react";
import type { StudioJob } from "@/types/studio";
import { useStudioMotion } from "@/hooks/use-studio-motion";

export function AgentCrew({ stage, presetName }: { stage?: StudioJob["stage"]; presetName: string }) {
  const scope = useStudioMotion(stage || "ready");
  const failed = stage === "failed", finished = stage === "completed", finalizing = stage === "finalizing";
  const composing = stage === "rendering", preparing = stage === "preparing";
  const nodes = [
    { name: "Director", icon: Video, state: "ready", detail: "Three shot instructions prepared" },
    { name: "Hook", icon: Type, state: "ready", detail: "Your opening text selected" },
    { name: "Captions", icon: MessageSquareText, state: preparing ? "active" : "ready", detail: preparing ? "Applying shot overlays" : "Your overlay settings prepared" },
    { name: "Editor", icon: Clapperboard, state: composing || preparing ? "active" : finished || finalizing ? "ready" : "waiting", detail: composing ? `Rendering ${presetName}` : preparing ? "Preparing the three-shot edit" : finished || finalizing ? "Reel encoded" : "Waiting for the render worker" },
    { name: "Cover", icon: ScanLine, state: finalizing ? "active" : finished ? "ready" : "waiting", detail: finalizing ? "Extracting three cover frames" : finished ? "Three actual frames extracted" : "Frames follow the finished edit" },
  ];
  return <div ref={scope} className="agent-crew" aria-label="Agent Crew workflow"><p className="eyebrow">YOUR CREATIVE CREW</p><div className="crew-nodes">{nodes.map((node) => <div data-reveal className={`crew-node ${failed ? "waiting" : node.state}`} key={node.name}><node.icon size={19} /><div><b>{node.name}</b><span>{node.detail}</span></div>{node.state === "ready" && !failed ? <Check size={14} /> : <Circle size={12} />}</div>)}</div><p className="privacy">Rules-based creative tools. These stages reflect your settings and real processing; no remote AI conversations are simulated.</p></div>;
}
