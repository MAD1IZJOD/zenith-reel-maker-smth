import type { Metadata } from "next";
import { PodcastStudio } from "@/components/podcast/podcast-studio";

export const metadata: Metadata = { title: "Create from video or podcast · ZENITH AGENTIC REEL MAKER" };
export default function PodcastPage() { return <PodcastStudio />; }
