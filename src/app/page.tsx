import Studio from "@/components/studio";
import { podcastAvailability } from "@/lib/server/features";

// Rendered per request: whether Podcast to reels can run depends on the host, not the build machine.
export const dynamic = "force-dynamic";
export default async function Home() { return <Studio podcastEnabled={(await podcastAvailability()).enabled} />; }
