import { prisma } from "@/lib/prisma";
import { getCountryDisplay } from "@/lib/countries";
import { STAT_WINDOWS, DEFAULT_WINDOW } from "@/lib/playerStats";
import { PlayerDirectory, type PlayerListEntry } from "@/app/components/PlayerDirectory";

export const dynamic = "force-dynamic";

const DEFAULT_DAYS = STAT_WINDOWS.find((w) => w.key === DEFAULT_WINDOW)!.days!;

interface AggregateRow {
  playerId: number;
  gamesAll: number;
  gamesRecent: number;
  wins: number;
  decided: number;
}

async function getDirectory(): Promise<PlayerListEntry[]> {
  const cutoff = new Date(Date.now() - DEFAULT_DAYS * 24 * 60 * 60 * 1000);

  // One grouped pass over the box scores rather than pulling ~18k rows into
  // the app to count them. The list mirrors the player page's default window,
  // so a player's win rate reads the same in both places.
  const [aggregates, players] = await Promise.all([
    prisma.$queryRaw<AggregateRow[]>`
      SELECT gs.playerId AS playerId,
             COUNT(*) AS gamesAll,
             SUM(CASE WHEN m.startTime >= ${cutoff} THEN 1 ELSE 0 END) AS gamesRecent,
             SUM(CASE WHEN m.startTime >= ${cutoff} AND g.winnerTeamId = gs.teamId THEN 1 ELSE 0 END) AS wins,
             SUM(CASE WHEN m.startTime >= ${cutoff} AND g.winnerTeamId IS NOT NULL THEN 1 ELSE 0 END) AS decided
      FROM GameStat gs
      JOIN Game g ON g.id = gs.gameId
      JOIN "Match" m ON m.id = g.matchId
      WHERE g.state = 'completed'
      GROUP BY gs.playerId
    `,
    prisma.player.findMany({ include: { team: true } }),
  ]);

  const byPlayer = new Map<number, AggregateRow>();
  for (const row of aggregates) {
    // SQLite's SUM/COUNT can come back as BigInt through the driver adapter.
    byPlayer.set(Number(row.playerId), {
      playerId: Number(row.playerId),
      gamesAll: Number(row.gamesAll),
      gamesRecent: Number(row.gamesRecent),
      wins: Number(row.wins),
      decided: Number(row.decided),
    });
  }

  const entries = players.map((p): PlayerListEntry => {
    const agg = byPlayer.get(p.id);
    const games = agg?.gamesRecent ?? 0;
    const decided = agg?.decided ?? 0;
    const wins = agg?.wins ?? 0;
    const country = getCountryDisplay(p.country);
    return {
      id: p.id,
      handle: p.handle,
      realName: p.realName,
      countryFlag: country?.flag ?? null,
      countryName: country?.name ?? null,
      role: p.role,
      teamName: p.team?.name ?? null,
      teamCode: p.team?.code ?? null,
      teamLogo: p.team?.logoUrl ?? null,
      teamSlug: p.team?.slug ?? null,
      region: p.team?.region ?? null,
      games,
      wins,
      losses: decided - wins,
      winRate: decided > 0 ? wins / decided : null,
      gamesWithResult: decided,
    };
  });

  // Most active first — the players someone is most likely to be looking for.
  // Players with nothing in the window still sort by their overall history so
  // the tail stays in a sensible order rather than arbitrary id order.
  return entries.sort(
    (a, b) => b.games - a.games || (byPlayer.get(b.id)?.gamesAll ?? 0) - (byPlayer.get(a.id)?.gamesAll ?? 0) || a.handle.localeCompare(b.handle)
  );
}

export default async function PlayersPage() {
  const players = await getDirectory();

  return (
    <main className="container wide">
      <h1 className="page-title">Players</h1>
      <p className="page-subtitle">
        Every pro we hold box scores for. Games and win rate cover the last {DEFAULT_DAYS} days.
      </p>
      <PlayerDirectory players={players} />
    </main>
  );
}
