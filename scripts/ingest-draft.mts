// DRAFT INGESTION — bans + Void Grubs from Leaguepedia's Cargo API, the one
// piece of per-game data that neither of Riot's own feeds expose at all.
// Run:  npx tsx scripts/ingest-draft.mts [limit] [--force]
//
// This is NOT part of `refresh`/`watch` — Leaguepedia's API rate-limits hard
// on bursts (a handful of requests in a few seconds earns a ~1-2 minute
// block), so this deliberately runs slowly, one request every few seconds,
// as its own occasional/manual script.
//
// Matching a game to a Leaguepedia row is best-effort: there's no shared id
// (RiotGameId is usually blank on their side, RiotPlatformGameId uses a
// different scheme than our externalId), so we match by team names + game
// number within a date window instead. Minor-league games in particular may
// just never show up there — that's not a bug, it means no one's logged it.
//
// teamABans is used as the "have we even tried this game" marker:
//   null       -> never attempted
//   ""         -> attempted, nothing found on Leaguepedia (don't retry every run)
//   "id,id,.." -> found and resolved

import { prisma } from "../lib/prisma.ts";
import { findLeaguepediaGame } from "../lib/leaguepedia.ts";
import { getChampionIdByName } from "../lib/champions.ts";

const DELAY_MS = 4000; // baseline spacing between requests
const RATE_LIMIT_BACKOFF_MS = 75_000;
const MAX_RETRIES_PER_GAME = 2;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force") || args.includes("-f");
  const limitArg = args.find((a) => /^\d+$/.test(a));
  const limit = limitArg ? Number(limitArg) : undefined;

  const games = await prisma.game.findMany({
    where: { state: "completed", ...(force ? {} : { teamABans: null }) },
    include: { match: { include: { teamA: true, teamB: true } } },
    orderBy: { match: { startTime: "desc" } },
    take: limit,
  });

  console.log(`${games.length} games to look up on Leaguepedia (this is slow on purpose — ~${DELAY_MS / 1000}s/game).\n`);

  let found = 0;
  let notFound = 0;
  let skippedRateLimit = 0;

  for (const game of games) {
    const { teamA, teamB } = game.match;
    let result = null;
    let attempt = 0;
    while (attempt <= MAX_RETRIES_PER_GAME) {
      result = await findLeaguepediaGame(teamA.name, teamB.name, game.match.startTime, game.number);
      if (result.ok) break;
      if (!result.rateLimited) break; // network/other error — don't hammer it, move on
      attempt++;
      console.log(`  rate-limited, backing off ${RATE_LIMIT_BACKOFF_MS / 1000}s (attempt ${attempt})...`);
      await sleep(RATE_LIMIT_BACKOFF_MS);
    }

    if (!result || !result.ok) {
      console.log(`  ${teamA.code} vs ${teamB.code} map${game.number} — skipped (still rate-limited)`);
      skippedRateLimit++;
    } else if (!result.game) {
      await prisma.game.update({ where: { id: game.id }, data: { teamABans: "", teamBBans: "" } });
      console.log(`  ${teamA.code} vs ${teamB.code} map${game.number} — not on Leaguepedia`);
      notFound++;
    } else {
      const { team1Bans, team2Bans, team1VoidGrubs, team2VoidGrubs, team1RiftHeralds, team2RiftHeralds } = result.game;
      const teamABans = team1Bans.map(getChampionIdByName).filter((id): id is string => !!id).join(",");
      const teamBBans = team2Bans.map(getChampionIdByName).filter((id): id is string => !!id).join(",");
      await prisma.game.update({
        where: { id: game.id },
        data: {
          teamABans,
          teamBBans,
          teamAVoidGrubs: team1VoidGrubs,
          teamBVoidGrubs: team2VoidGrubs,
          teamARiftHeralds: team1RiftHeralds,
          teamBRiftHeralds: team2RiftHeralds,
        },
      });
      console.log(
        `  ${teamA.code} vs ${teamB.code} map${game.number} — found (grubs ${team1VoidGrubs}-${team2VoidGrubs}, heralds ${team1RiftHeralds}-${team2RiftHeralds})`
      );
      found++;
    }

    await sleep(DELAY_MS);
  }

  console.log(`\nFound: ${found}  Not on Leaguepedia: ${notFound}  Skipped (rate limit): ${skippedRateLimit}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Draft ingestion failed:", err);
  process.exit(1);
});
