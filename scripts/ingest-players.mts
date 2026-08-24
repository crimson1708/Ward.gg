// PLAYER PROFILE INGESTION — real names and headshots for the players pages.
// Run:  npx tsx scripts/ingest-players.mts
//
// The live-stats feed that creates Player rows (ingest-games) only ever knows
// a player's in-game summoner name — no real name, no photo. Both live on the
// esports API's roster endpoint instead, which is keyed by the SAME
// esportsPlayerId we already store as Player.externalId, so this joins exactly
// rather than by fuzzy name matching.
//
// One request gets every team's roster at once, so this is cheap enough to run
// on a slow cadence; rosters only change at splits/transfer windows.
//
// Country is NOT available from this source (see lib/leaguepedia.ts for the
// only source that has it) — this script leaves Player.country alone.

import { pathToFileURL } from "node:url";
import { prisma } from "../lib/prisma.ts";
import { getTeams } from "../lib/lolEsports.ts";

// The API hands out one shared placeholder headshot for players with no photo.
// Storing it would make "has a photo" untestable downstream, so treat it as
// absent instead.
const PLACEHOLDER_IMAGE = "default-headshot.png";

function fullName(firstName?: string, lastName?: string): string | null {
  const name = [firstName, lastName].filter(Boolean).join(" ").trim();
  return name || null;
}

export async function runPlayersIngest() {
  const teams = await getTeams();
  console.log(`Teams fetched: ${teams.length}`);

  // Collapse to one entry per esports player id. A player can appear on more
  // than one team's roster (academy call-ups, mid-split moves that the API
  // hasn't fully reconciled); last write wins, which is fine for name/photo.
  const byExternalId = new Map<string, { realName: string | null; imageUrl: string | null }>();
  for (const team of teams) {
    for (const p of team.players ?? []) {
      if (!p.id) continue;
      const imageUrl = p.image && !p.image.includes(PLACEHOLDER_IMAGE) ? p.image : null;
      byExternalId.set(p.id, { realName: fullName(p.firstName, p.lastName), imageUrl });
    }
  }
  console.log(`Distinct roster players: ${byExternalId.size}`);

  // Only touch players we already have. Creating rows for every rostered pro
  // would fill the players list with people who have never appeared in a game
  // we hold stats for, which is exactly what the pages are built to show.
  const existing = await prisma.player.findMany({ select: { id: true, externalId: true, realName: true, imageUrl: true } });

  let updated = 0;
  let matched = 0;
  for (const row of existing) {
    const info = byExternalId.get(row.externalId);
    if (!info) continue;
    matched++;
    // Skip no-op writes so a re-run doesn't churn every row on Turso.
    if (row.realName === info.realName && row.imageUrl === info.imageUrl) continue;
    await prisma.player.update({
      where: { id: row.id },
      data: { realName: info.realName, imageUrl: info.imageUrl },
    });
    updated++;
  }

  console.log(`Players matched to a roster: ${matched}/${existing.length}, updated: ${updated}`);
  return { teams: teams.length, rosterPlayers: byExternalId.size, matched, updated };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPlayersIngest()
    .then(() => prisma.$disconnect())
    .catch((err) => {
      console.error("Player ingestion failed:", err);
      process.exit(1);
    });
}
