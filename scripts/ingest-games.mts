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

import { pathToFileURL } from "node:url";
import { prisma } from "../lib/prisma.ts";
import { getEventDetails, getGameWindow, getGameDetails } from "../lib/lolEsports.ts";

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

// Default is INCREMENTAL — we skip matches whose games have all already been
// CHECKED (statsChecked, set regardless of whether a feed was actually found —
// see the Game model comment), which makes repeat runs nearly instant. Pass
// force:true to reprocess everything, including known-no-feed games.
export async function runGamesIngest(options: { limit?: number; force?: boolean } = {}) {
  const { limit, force = false } = options;

  const matches = await prisma.match.findMany({
    where: { status: "completed" },
    include: { teamA: true, teamB: true, games: { select: { state: true, statsChecked: true } } },
    orderBy: { startTime: "desc" },
    take: limit,
  });

  // Needs work if we've never seen this match's games at all, or if any of
  // its completed games hasn't been checked yet (found stats or confirmed
  // no feed exists — either way, statsChecked is set so we don't redo it).
  const todo = matches.filter((m) => {
    if (force) return true;
    if (m.games.length === 0) return true;
    return m.games.some((g) => g.state === "completed" && !g.statsChecked);
  });
  console.log(
    `${matches.length} completed matches — ${matches.length - todo.length} already have stats (skipped), ${todo.length} to process.\n`
  );

  let gamesUpserted = 0;
  let statsUpserted = 0;
  let matchesWithStats = 0;

  for (const match of todo) {
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
      if (!force && gameRow.statsChecked) continue; // already checked (found or confirmed no feed)

      // side ("blue"/"red") -> our team id, from this game's team/side mapping.
      const ourTeamIdBySide: Record<string, number | undefined> = {};
      for (const gt of g.teams) ourTeamIdBySide[gt.side] = ourTeamIdByApiId[gt.id];

      const winResult = await getGameWindow(g.id, match.startTime.getTime());
      if (!winResult) {
        // No live-stats feed exists for this game (common for minor leagues) —
        // mark it checked so we don't burn the full offset-ladder probe again
        // on every future run trying to find something that isn't there.
        await prisma.game.update({ where: { id: gameRow.id }, data: { statsChecked: true } });
        continue;
      }
      const { data: win, startingTime } = winResult;
      matchHadStats = true;

      // Prefer the frame where the game is actually reported "finished" — the
      // array's last element is usually that frame, but fall back to it
      // explicitly in case getGameWindow had to settle for a best-effort,
      // still-in-progress response (see the ladder/fallback logic there).
      const lastFrame =
        [...win.frames].reverse().find((f) => f.gameState === "finished") ?? win.frames[win.frames.length - 1];
      const statByPid = new Map<number, (typeof lastFrame.blueTeam.participants)[number]>();
      for (const p of [...lastFrame.blueTeam.participants, ...lastFrame.redTeam.participants]) {
        statByPid.set(p.participantId, p);
      }

      // Team-level objectives/gold, keyed to teamA/teamB (not blue/red — sides
      // swap between games in a series, but which team is "A" doesn't).
      const teamAIsBlue = ourTeamIdBySide.blue === match.teamAId;
      const teamAObjectives = teamAIsBlue ? lastFrame.blueTeam : lastFrame.redTeam;
      const teamBObjectives = teamAIsBlue ? lastFrame.redTeam : lastFrame.blueTeam;
      await prisma.game.update({
        where: { id: gameRow.id },
        data: {
          teamADragons: teamAObjectives.dragons.join(","),
          teamBDragons: teamBObjectives.dragons.join(","),
          teamABarons: teamAObjectives.barons,
          teamBBarons: teamBObjectives.barons,
          teamAGold: teamAObjectives.totalGold,
          teamBGold: teamBObjectives.totalGold,
          statsChecked: true,
        },
      });

      // Final item build lives on a sibling endpoint (/details), not /window —
      // query it at the EXACT instant we just confirmed was "finished" above,
      // so items line up with these same K/D/A/gold numbers.
      const details = await getGameDetails(g.id, startingTime);
      const itemsByPid = new Map<number, number[]>();
      const keystoneByPid = new Map<number, number>();
      const secondaryTreeByPid = new Map<number, number>();
      if (details) {
        const lastDetailsFrame = details.frames[details.frames.length - 1];
        for (const p of lastDetailsFrame.participants) {
          itemsByPid.set(p.participantId, p.items);
          const keystone = p.perkMetadata?.perks?.[0];
          if (keystone) keystoneByPid.set(p.participantId, keystone);
          const secondaryTree = p.perkMetadata?.subStyleId;
          if (secondaryTree) secondaryTreeByPid.set(p.participantId, secondaryTree);
        }
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
        const items = itemsByPid.get(pm.participantId)?.join(",") ?? null;
        const keystone = keystoneByPid.get(pm.participantId) ?? null;
        const secondaryTree = secondaryTreeByPid.get(pm.participantId) ?? null;

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
            items, keystone, secondaryTree,
          },
          create: {
            gameId: gameRow.id, playerId: player.id, teamId: ourTeamId, side: pm.side, role: pm.role,
            champion: pm.championId, kills: s.kills, deaths: s.deaths, assists: s.assists,
            creepScore: s.creepScore, totalGold: s.totalGold, items, keystone, secondaryTree,
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
  console.log(`Matches with stats (this run): ${matchesWithStats}/${todo.length}`);
  const playerCount = await prisma.player.count();
  console.log(`Players in DB now: ${playerCount}`);

  return { gamesUpserted, statsUpserted, matchesWithStats, totalToProcess: todo.length, players: playerCount };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Args: an optional numeric limit, and --force to reprocess matches that
  // already have stats.
  const args = process.argv.slice(2);
  const force = args.includes("--force") || args.includes("-f");
  const limitArg = args.find((a) => /^\d+$/.test(a));
  const limit = limitArg ? Number(limitArg) : undefined;

  runGamesIngest({ limit, force })
    .then(() => prisma.$disconnect())
    .catch((err) => {
      console.error("Games ingestion failed:", err);
      process.exit(1);
    });
}
