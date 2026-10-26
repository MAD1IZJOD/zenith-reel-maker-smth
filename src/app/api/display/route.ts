import { approvedPlaylist, displaySettings } from "@/lib/festival/premiere";
import { leaderboard, leaderboardEnabled } from "@/lib/festival/leaderboard";
export const runtime = "nodejs";
export async function GET() {
  return Response.json({ settings: await displaySettings(), playlist: await approvedPlaylist(), entries: await leaderboard(), leaderboardEnabled: leaderboardEnabled() });
}
