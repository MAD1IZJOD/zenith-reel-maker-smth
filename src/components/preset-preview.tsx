"use client";
import { useState } from "react";
import Image from "next/image";
export function PresetPreview({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  return <div className="preset-art"><Image src={`/previews/${id}.jpg`} alt={`${name} rendered sample cover`} width={720} height={1280} sizes="(max-width:720px) 100vw, 33vw" unoptimized /><details className="preset-preview" onToggle={(event) => setOpen(event.currentTarget.open)}><summary>{open ? "Close sample edit" : "Watch sample edit"}</summary>{open && <video src={`/previews/${id}.mp4`} poster={`/previews/${id}.jpg`} aria-label={`${name} sample edit`} muted controls playsInline preload="metadata" />}</details></div>;
}
