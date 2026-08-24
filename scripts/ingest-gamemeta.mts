// GAME METADATA BACKFILL — per-game winner, patch, and duration.
// Run:  npx tsx scripts/ingest-gamemeta.mts [limit] [--winners-only]
//
// Three fields the original games ingest never captured, all needed by the
// player/champion stats pages: without a winner there is no win rate, and
// without a duration there is no CS/min or gold/min.
//
// Winner + patch come free off the same "finished" frame ingest-games already
// fetches, so new games get them inline there (see ingest-games.mts) and only
// pre-existing rows need this backfill. Duration is the expensive one — a
// ~10-request binary search for the game's first frame (see findGameStartMs)
// — so it stays out of the per-game ingest path entirely and lives here,
// bounded by `limit`, on its own slow cadence.
//
// Newest-first on purpose: the stats pages default to a recent window, so the
// games users actually look at get filled in first if this is interrupted.
//
// Idempotent — it only ever looks at rows still missing the fields, so
// re-running just continues where it left off.

import { pathToFileURL } from "node:url";
import { prisma } from "../lib/prisma.ts";
import { getGameWindow, findGameStartMs, inferGameWinner, shortPatch } from "../lib/lolEsports.ts";
import { runGameWinnerReconciliation } from "./audit.mts";

// Guards against a bogus binary-search result (e.g. a feed that starts serving
// data long before the game actually begins) polluting every CS/min on the site.
const MIN_PLAUSIBLE_SECS = 8 * 60;
const MAX_PLAUSIBLE_SECS = 95 * 60;

export async function runGameMetaIngest(options: { limit?: number; winnersOnly?: boolean } = {}) {
  const { limit, winnersOnly = false } = options;

  // Only games that actually have a stats feed are worth probing — the ~30
  // games with no feed at all (teamAGold null) have no frame to read either.
  const games = await prisma.game.findMany({
    where: {
      state: "completed",
      teamAGold: { not: null },
      ...(winnersOnly ? { winnerTeamId: null } : { OR: [{ winnerTeamId: null }, { durationSecs: null }] }),
    },
    include: { match: { select: { startTime: true, teamAId: true, teamBId: true, teamA: true, teamB: true } } },
    orderBy: { match: { startTime: "desc" } },
    ...(limit ? { take: limit } : {}),
  });

  console.log(`Games needing metadata: ${games.length}`);
  let winners = 0;
  let durations = 0;
  let skipped = 0;

  for (const g of games) {
    const result = await getGameWindow(g.externalId, g.match.startTime.getTime());
    if (!result) {
      skipped++;
      continue;
    }
    const frames = result.data.frames;
    const finalFrame = [...frames].reverse().find((f) => f.gameState === "finished");
    if (!finalFrame) {
      // Same rule as the live ingest: a mid-game snapshot would name whoever
      // was ahead at the time, not the actual winner. Skip rather than guess.
      skipped++;
      continue;
    }

    const data: { winnerTeamId?: number; patch?: string | null; durationSecs?: number } = {};

    if (g.winnerTeamId === null) {
      // Which physical team is blue in THIS game — same summoner-name-prefix
      // rule ingest-games uses, and for the same reason (getEventDetails and
      // the live-stats feed can disagree about sides).
      const blueNames = result.data.gameMetadata.blueTeamMetadata.participantMetadata.map((p) => p.summonerName);
      const redNames = result.data.gameMetadata.redTeamMetadata.participantMetadata.map((p) => p.summonerName);
      const countPrefix = (names: string[], code: string) => names.filter((n) => n.startsWith(code)).length;
      const aCode = g.match.teamA.code;
      const bCode = g.match.teamB.code;
      const signal =
        countPrefix(blueNames, aCode) + countPrefix(blueNames, bCode) + countPrefix(redNames, aCode) + countPrefix(redNames, bCode);
      if (signal > 0) {
        const teamAIsBlue =
          countPrefix(blueNames, aCode) + countPrefix(redNames, bCode) >=
          countPrefix(blueNames, bCode) + countPrefix(redNames, aCode);
        const teamAStats = teamAIsBlue ? finalFrame.blueTeam : finalFrame.redTeam;
        const teamBStats = teamAIsBlue ? finalFrame.redTeam : finalFrame.blueTeam;
        data.winnerTeamId = inferGameWinner(teamAStats, teamBStats) === "a" ? g.match.teamAId : g.match.teamBId;
        winners++;
      }
      data.patch = shortPatch(result.data.gameMetadata.patchVersion);
    }

    if (!winnersOnly && g.durationSecs === null) {
      const endMs = new Date(finalFrame.rfc460Timestamp).getTime();
      const startMs = await findGameStartMs(g.externalId, endMs);
      if (startMs !== null) {
        const secs = Math.round((endMs - startMs) / 1000);
        if (secs >= MIN_PLAUSIBLE_SECS && secs <= MAX_PLAUSIBLE_SECS) {
          data.durationSecs = secs;
          durations++;
        }
      }
    }

    if (Object.keys(data).length > 0) {
      await prisma.game.update({ where: { id: g.id }, data });
    }
  }

  // Hold the freshly-inferred winners to the series scores before they reach
  // the stats pages — the frame inference is wrong in a base race, and this is
  // where that gets caught (see runGameWinnerReconciliation).
  const reconciled = await runGameWinnerReconciliation();

  console.log(`Winners set: ${winners}, durations set: ${durations}, skipped: ${skipped}, re-assigned: ${reconciled.fixed}`);
  return { considered: games.length, winners, durations, skipped, reconciled: reconciled.fixed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const winnersOnly = args.includes("--winners-only");
  const limitArg = args.find((a) => /^\d+$/.test(a));
  runGameMetaIngest({ limit: limitArg ? Number(limitArg) : undefined, winnersOnly })
    .then(() => prisma.$disconnect())
    .catch((err) => {
      console.error("Game metadata ingestion failed:", err);
      process.exit(1);
    });
}
