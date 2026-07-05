// INGESTION JOB #2 — fills Game, GameStat, and Player for COMPLETED matches.
// Run:  npx tsx scripts/ingest-games.mts [limit]
//   e.g. npx tsx scripts/ingest-games.mts 10   (process 10 most-recent matches)
//
// For each completed match we already have, this:
//   1. fetches its games (getEventDetails) — which carry REAL team ids + side,
//   2. maps blue/red -> our team rows,
//   3. for each finished game with a stats feed, upserts Players and their
//      per-game box score (GameStat).
// Matches with no stats feed (many minor leagues) still get Game rows, just no stats.

import { prisma } from "../lib/prisma.ts";
import { getEventDetails, getGameWindow } from "../lib/lolEsports.ts";

// Strip a leading team-code prefix: "T1 Doran" -> "Doran".
function cleanHandle(summonerName: string, teamCode: string): string {
  const prefix = `${teamCode} `;
  return summonerName.startsWith(prefix) ? summonerName.slice(prefix.length) : summonerName;
}

// Not every participant has an esportsPlayerId (subs, unregistered players). Fall
// back to a name-derived key so those players still get one stable row.
function playerKey(esportsPlayerId: string | undefined, summonerName: string): string {
  if (esportsPlayerId && esportsPlayerId !== "0") return esportsPlayerId;
  return "sn:" + summonerName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function main() {
  const limit = process.argv[2] ? Number(process.argv[2]) : undefined;

  const matches = await prisma.match.findMany({
    where: { status: "completed" },
    include: { teamA: true, teamB: true },
    orderBy: { startTime: "desc" },
    take: limit,
  });
  console.log(`Processing ${matches.length} completed matches...\n`);

  let gamesUpserted = 0;
  let statsUpserted = 0;
  let matchesWithStats = 0;

  for (const match of matches) {
    const details = await getEventDetails(match.externalId);

    // Map the API's team id -> OUR team id, by matching the 3-letter code
    // (a match only has two teams, so codes won't collide here).
    const ourTeamIdByCode: Record<string, number> = {
      [match.teamA.code]: match.teamAId,
      [match.teamB.code]: match.teamBId,
    };
    const codeByOurId: Record<number, string> = {
      [match.teamAId]: match.teamA.code,
      [match.teamBId]: match.teamB.code,
    };
    const ourTeamIdByApiId: Record<string, number> = {};
    for (const t of details.teams) {
      const our = ourTeamIdByCode[t.code];
      if (our) ourTeamIdByApiId[t.id] = our;
    }

    let matchHadStats = false;

    for (const g of details.games) {
      // Upsert the Game row (even "unneeded" games — the detail page shows them).
      const gameRow = await prisma.game.upsert({
        where: { externalId: g.id },
        update: { number: g.number, state: g.state },
        create: { externalId: g.id, matchId: match.id, number: g.number, state: g.state },
      });
      gamesUpserted++;

      if (g.state !== "completed") continue;

      // side ("blue"/"red") -> our team id, from this game's team/side mapping.
      const ourTeamIdBySide: Record<string, number | undefined> = {};
      for (const gt of g.teams) ourTeamIdBySide[gt.side] = ourTeamIdByApiId[gt.id];

      const win = await getGameWindow(g.id, match.startTime.getTime());
      if (!win) continue; // no stats feed for this game
      matchHadStats = true;

      // Index the final numbers by participantId (1..10).
      const lastFrame = win.frames[win.frames.length - 1];
      const statByPid = new Map<number, (typeof lastFrame.blueTeam.participants)[number]>();
      for (const p of [...lastFrame.blueTeam.participants, ...lastFrame.redTeam.participants]) {
        statByPid.set(p.participantId, p);
      }

      // Metadata tells us WHO each participant is; tag each with its side.
      const roster = [
        ...win.gameMetadata.blueTeamMetadata.participantMetadata.map((m) => ({ ...m, side: "BLUE" as const })),
        ...win.gameMetadata.redTeamMetadata.participantMetadata.map((m) => ({ ...m, side: "RED" as const })),
      ];

      for (const pm of roster) {
        const s = statByPid.get(pm.participantId);
        const ourTeamId = ourTeamIdBySide[pm.side.toLowerCase()];
        if (!s || !ourTeamId) continue;

        const handle = cleanHandle(pm.summonerName, codeByOurId[ourTeamId] ?? "");
        const externalId = playerKey(pm.esportsPlayerId, pm.summonerName);

        // Upsert the Player (keyed on esportsPlayerId, or a name fallback).
        const player = await prisma.player.upsert({
          where: { externalId },
          update: { handle, role: pm.role, teamId: ourTeamId },
          create: { externalId, handle, role: pm.role, teamId: ourTeamId },
        });

        // Upsert their box score for this game (unique per game+player).
        await prisma.gameStat.upsert({
          where: { gameId_playerId: { gameId: gameRow.id, playerId: player.id } },
          update: {
            teamId: ourTeamId, side: pm.side, role: pm.role, champion: pm.championId,
            kills: s.kills, deaths: s.deaths, assists: s.assists, creepScore: s.creepScore, totalGold: s.totalGold,
          },
          create: {
            gameId: gameRow.id, playerId: player.id, teamId: ourTeamId, side: pm.side, role: pm.role,
            champion: pm.championId, kills: s.kills, deaths: s.deaths, assists: s.assists,
            creepScore: s.creepScore, totalGold: s.totalGold,
          },
        });
        statsUpserted++;
      }
    }

    if (matchHadStats) matchesWithStats++;
    console.log(`  ${match.teamA.code} vs ${match.teamB.code} — ${matchHadStats ? "stats ✓" : "no feed"}`);
  }

  console.log(`\nGames upserted: ${gamesUpserted}`);
  console.log(`Stat rows upserted: ${statsUpserted}`);
  console.log(`Matches with stats: ${matchesWithStats}/${matches.length}`);
  console.log(`Players in DB now: ${await prisma.player.count()}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Games ingestion failed:", err);
  process.exit(1);
});
