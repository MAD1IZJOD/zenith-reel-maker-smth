import Studio from "@/components/studio";
import { podcastAvailability } from "@/lib/server/features";

export const dynamic = "force-dynamic";
export default async function FestivalPage() { return <Studio festival podcastEnabled={(await podcastAvailability()).enabled} />; }
