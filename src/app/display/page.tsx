import DisplayScreen from "@/components/display-screen";
export const dynamic = "force-dynamic";
export default function DisplayPage() { return <DisplayScreen publicBaseUrl={process.env.PUBLIC_BASE_URL || ""} />; }
