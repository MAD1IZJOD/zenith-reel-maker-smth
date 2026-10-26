import type { Metadata } from "next";
import Link from "next/link";
import { PodcastStudio } from "@/components/podcast/podcast-studio";
import { podcastAvailability } from "@/lib/server/features";

export const metadata: Metadata = { title: "Podcast to reels · ZENITH AGENTIC REEL MAKER" };
export const dynamic = "force-dynamic";
export default async function PodcastPage() {
  const availability = await podcastAvailability();
  if (availability.enabled) return <PodcastStudio />;
  return <main><section className="page podcast-unavailable"><p className="eyebrow">PODCAST TO REELS · UNAVAILABLE</p><h2>Not available here today.</h2><p className="lede">{availability.reason} Nothing was uploaded.</p><div className="actions"><Link className="primary" href="/">Create from clips</Link></div></section></main>;
}
