// DRAFT + PLAYER-DETAIL INGESTION — bans, Void Grubs, Rift Heralds, and
// per-player items/runes/summoner spells, all from Leaguepedia's Cargo API.
// This is the one place to get any of these: Riot's own feeds have no
// draft/objective data at all, and the live-stats feed's item snapshot
// misses wards/boots/support items often enough to be a real gap — and
// never carries summoner spells in the first place.
// Run:  npx tsx scripts/ingest-draft.mts [limit] [--force]
//
// This is NOT part of `refresh`/`watch` — Leaguepedia's API rate-limits hard
// on bursts (a handful of requests in a few seconds earns a ~1-2 minute
// block), so this deliberately runs slowly, one game every few seconds,
// as its own occasional/manual script.
//
// Matching a GAME to a Leaguepedia row is best-effort: there's no shared id
// (RiotGameId is usually blank on their side, RiotPlatformGameId uses a
// different scheme than our externalId), so we match by team names + game
// number within a date window instead. Minor-league games in particular may
// just never show up there — that's not a bug, it means no one's logged it.
// Once a game IS matched, though, Leaguepedia's own GameId is an exact join
// key into its per-player table — no more guessing needed for that part.
//
// teamABans is used as the "have we even tried this game" marker:
//   null       -> never attempted
//   ""         -> attempted, nothing found on Leaguepedia (don't retry every run)
//   "id,id,.." -> found and resolved
// GameStat.leaguepediaChecked is the equivalent per-player marker.

import { prisma } from "../lib/prisma.ts";
import { findLeaguepediaGame, findLeaguepediaPlayers, type LeaguepediaPlayerRow } from "../lib/leaguepedia.ts";
import { getChampionIdByName } from "../lib/champions.ts";
import { getItemIdByName } from "../lib/items.ts";
import { getRuneIdByName } from "../lib/runes.ts";
import { getSummonerSpellIdByName } from "../lib/summonerSpells.ts";

const DELAY_MS = 4000; // baseline spacing between requests
const RATE_LIMIT_BACKOFF_MS = 75_000;
const MAX_RETRIES_PER_GAME = 2;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Leaguepedia's build/rune/spell values are display names; convert each to
// our own ids and drop anything we don't recognize (a brand-new item/spell
// this run hasn't been added to our generated data files) rather than fail
// the whole player's row over it.
function applyPlayerDetails(row: LeaguepediaPlayerRow) {
  const coreItemIds = row.items.map(getItemIdByName).filter((id): id is number => id !== null);
  const roleBoundId = row.roleBoundItem ? getItemIdByName(row.roleBoundItem) : null;
  const trinketId = row.trinket ? getItemIdByName(row.trinket) : null;

  const allItemIds = [...coreItemIds];
  if (roleBoundId !== null && !allItemIds.includes(roleBoundId)) allItemIds.push(roleBoundId);
  if (trinketId !== null && !allItemIds.includes(trinketId)) allItemIds.push(trinketId);

  const spellIds = row.summonerSpells.map(getSummonerSpellIdByName).filter((id): id is number => id !== null);
  const keystoneId = row.keystoneRune ? getRuneIdByName(row.keystoneRune) : null;
  const secondaryTreeId = row.secondaryTree ? getRuneIdByName(row.secondaryTree) : null;

  return {
    ...(allItemIds.length > 0 ? { items: allItemIds.join(",") } : {}),
    ...(spellIds.length > 0 ? { summonerSpells: spellIds.join(",") } : {}),
    ...(keystoneId !== null ? { keystone: keystoneId } : {}),
    ...(secondaryTreeId !== null ? { secondaryTree: secondaryTreeId } : {}),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force") || args.includes("-f");
  const limitArg = args.find((a) => /^\d+$/.test(a));
  const limit = limitArg ? Number(limitArg) : undefined;

  const games = await prisma.game.findMany({
    where: {
      state: "completed",
      ...(force ? {} : { OR: [{ teamABans: null }, { stats: { some: { leaguepediaChecked: false } } }] }),
    },
    include: {
      match: { include: { teamA: true, teamB: true } },
      stats: true,
    },
    orderBy: { match: { startTime: "desc" } },
    take: limit,
  });

  console.log(`${games.length} games to look up on Leaguepedia (this is slow on purpose — ~${DELAY_MS / 1000}s/game, plus a second request per game for player detail).\n`);

  let draftFound = 0;
  let draftNotFound = 0;
  let playersFound = 0;
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
      await sleep(DELAY_MS);
      continue;
    }

    if (!result.game) {
      await prisma.game.update({ where: { id: game.id }, data: { teamABans: "", teamBBans: "" } });
      if (game.stats.length > 0) {
        await prisma.gameStat.updateMany({ where: { gameId: game.id }, data: { leaguepediaChecked: true } });
      }
      console.log(`  ${teamA.code} vs ${teamB.code} map${game.number} — not on Leaguepedia`);
      draftNotFound++;
      await sleep(DELAY_MS);
      continue;
    }

    const { gameId, team1Bans, team2Bans, team1VoidGrubs, team2VoidGrubs, team1RiftHeralds, team2RiftHeralds } =
      result.game;
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
      `  ${teamA.code} vs ${teamB.code} map${game.number} — draft found (grubs ${team1VoidGrubs}-${team2VoidGrubs}, heralds ${team1RiftHeralds}-${team2RiftHeralds})`
    );
    draftFound++;

    // Player detail needs its own request against the game id we just got —
    // only worth making if this game actually has box-score rows to attach
    // it to, and only for rows we haven't already resolved.
    const pendingStats = game.stats.filter((s) => force || !s.leaguepediaChecked);
    if (pendingStats.length === 0 || !gameId) {
      await sleep(DELAY_MS);
      continue;
    }

    await sleep(DELAY_MS);

    let playersResult = null;
    attempt = 0;
    while (attempt <= MAX_RETRIES_PER_GAME) {
      playersResult = await findLeaguepediaPlayers(gameId);
      if (playersResult.ok) break;
      if (!playersResult.rateLimited) break;
      attempt++;
      console.log(`  rate-limited (players), backing off ${RATE_LIMIT_BACKOFF_MS / 1000}s (attempt ${attempt})...`);
      await sleep(RATE_LIMIT_BACKOFF_MS);
    }

    if (!playersResult || !playersResult.ok) {
      console.log(`  ${teamA.code} vs ${teamB.code} map${game.number} — player detail skipped (still rate-limited)`);
      skippedRateLimit++;
      await sleep(DELAY_MS);
      continue;
    }

    const lpPlayers = playersResult.players;
    let matchedThisGame = 0;
    for (const stat of pendingStats) {
      const ourTeamName = stat.teamId === game.match.teamAId ? teamA.name : teamB.name;
      const matchedRow = lpPlayers.find(
        (p) => p.team.trim().toLowerCase() === ourTeamName.trim().toLowerCase() && getChampionIdByName(p.champion) === stat.champion
      );

      if (!matchedRow) {
        await prisma.gameStat.update({ where: { id: stat.id }, data: { leaguepediaChecked: true } });
        continue;
      }

      await prisma.gameStat.update({
        where: { id: stat.id },
        data: { ...applyPlayerDetails(matchedRow), leaguepediaChecked: true },
      });
      matchedThisGame++;
    }
    playersFound += matchedThisGame;
    console.log(`  ${teamA.code} vs ${teamB.code} map${game.number} — player detail: ${matchedThisGame}/${pendingStats.length} matched`);

    await sleep(DELAY_MS);
  }

  console.log(
    `\nDraft — found: ${draftFound}  not on Leaguepedia: ${draftNotFound}\nPlayer rows enriched: ${playersFound}\nSkipped (rate limit): ${skippedRateLimit}`
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Draft ingestion failed:", err);
  process.exit(1);
});
