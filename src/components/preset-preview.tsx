"use client";
import { useState } from "react";
export function PresetPreview({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  return <details className="preset-preview" onToggle={(event) => setOpen(event.currentTarget.open)}><summary>Watch sample edit</summary>{open && <video src={`/previews/${id}.mp4`} poster={`/previews/${id}.jpg`} aria-label={`${name} sample edit`} muted controls playsInline preload="metadata" />}</details>;
}
