"use client";
import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

/** One scoped, finite entrance. MatchMedia also responds to preference changes. */
export function useStudioMotion(key: string) {
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.from("[data-reveal]", { y: 16, opacity: 0, duration: 0.45, stagger: 0.07, ease: "power2.out", clearProps: "transform,opacity" });
    });
    return () => media.revert();
  }, { scope, dependencies: [key], revertOnUpdate: true });
  return scope;
}
