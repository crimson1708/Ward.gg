import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getChampionInfo } from "@/lib/champions";
import { getCountryDisplay } from "@/lib/countries";
import { computeAllWindows, type PlayerGameAppearance, type StatWindowKey } from "@/lib/playerStats";
import { ChampionStats, type WindowDisplay } from "@/app/components/ChampionStats";

export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<string, string> = {
  top: "Top",
  jungle: "Jungle",
  mid: "Mid",
  bottom: "Bot",
  support: "Support",
};

async function getPlayerData(playerId: number) {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: { team: true },
  });
  if (!player) return null;

  const stats = await prisma.gameStat.findMany({
    where: { playerId, game: { state: "completed" } },
    include: { game: { include: { match: { select: { startTime: true } } } } },
  });

  // Kill participation needs the player's TEAM's kill total for each game,
  // which lives across their team-mates' rows — one extra query for every
  // game they appeared in, rather than N per game.
  const gameIds = stats.map((s) => s.gameId);
  const teamKillRows = await prisma.gameStat.groupBy({
    by: ["gameId", "teamId"],
    where: { gameId: { in: gameIds } },
    _sum: { kills: true },
  });
  const teamKills = new Map<string, number>();
  for (const row of teamKillRows) {
    teamKills.set(`${row.gameId}:${row.teamId}`, row._sum.kills ?? 0);
  }

  const appearances: PlayerGameAppearance[] = stats.map((s) => ({
    champion: s.champion,
    kills: s.kills,
    deaths: s.deaths,
    assists: s.assists,
    creepScore: s.creepScore,
    totalGold: s.totalGold,
    teamId: s.teamId,
    startTime: s.game.match.startTime,
    durationSecs: s.game.durationSecs,
    winnerTeamId: s.game.winnerTeamId,
    teamKills: teamKills.get(`${s.gameId}:${s.teamId}`) ?? null,
  }));

  return { player, appearances };
}

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playerId = Number(id);
  if (Number.isNaN(playerId)) notFound();

  const data = await getPlayerData(playerId);
  if (!data) notFound();
  const { player, appearances } = data;

  // Resolve champion display data server-side so the champion JSON stays out
  // of the client bundle.
  const raw = computeAllWindows(appearances);
  const windows = Object.fromEntries(
    Object.entries(raw).map(([key, w]) => [
      key,
      {
        ...w,
        champions: w.champions.map((c) => {
          const info = getChampionInfo(c.champion);
          return { ...c, name: info.name, iconUrl: info.iconUrl };
        }),
      } satisfies WindowDisplay,
    ])
  ) as Record<StatWindowKey, WindowDisplay>;

  const country = getCountryDisplay(player.country);
  const roleLabel = player.role ? ROLE_LABELS[player.role] ?? player.role : null;

  return (
    <main className="container wide">
      <Link className="back-link" href="/players">
        ← All players
      </Link>

      <header className="player-header">
        {player.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="player-photo" src={player.imageUrl} alt="" />
        ) : (
          <span className="player-photo placeholder" aria-hidden="true">
            {player.handle.slice(0, 1).toUpperCase()}
          </span>
        )}

        <div className="player-identity">
          <h1 className="player-handle">
            {player.handle}
            {country && (
              <span className="player-flag" title={country.name}>
                {country.flag ?? country.name}
              </span>
            )}
          </h1>
          {player.realName && <p className="player-realname">{player.realName}</p>}
          <div className="player-meta">
            {roleLabel && <span className="role-badge">{roleLabel}</span>}
            {player.team && (
              <Link className="player-team" href={`/players?team=${encodeURIComponent(player.team.slug)}`}>
                {player.team.logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="team-logo-sm" src={player.team.logoUrl} alt="" />
                )}
                {player.team.name}
              </Link>
            )}
          </div>
        </div>
      </header>

      {appearances.length === 0 ? (
        <p className="empty">No recorded games for this player yet.</p>
      ) : (
        <ChampionStats windows={windows} />
      )}
    </main>
  );
}
