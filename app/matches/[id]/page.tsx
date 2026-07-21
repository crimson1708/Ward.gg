import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { MatchTabs, type MapTab } from "@/app/components/MatchTabs";
import type { StatRow } from "@/app/components/BoxScore";
import type { GameSummaryData } from "@/app/components/GameSummary";

export const dynamic = "force-dynamic";

// Show players in lane order rather than however the API returned them.
const ROLE_ORDER = ["top", "jungle", "mid", "bottom", "support"];
function byRole<T extends { role: string }>(a: T, b: T) {
  return ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
}

function parseItems(items: string | null): number[] {
  return items ? items.split(",").map(Number) : [];
}

function parseCommaList(s: string | null): string[] {
  return s ? s.split(",").filter(Boolean) : [];
}

// In Next 16, dynamic route `params` is a Promise you must await.
export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const matchId = Number(id);
  if (Number.isNaN(matchId)) notFound();

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      league: true,
      teamA: true,
      teamB: true,
      games: {
        orderBy: { number: "asc" },
        include: { stats: { include: { player: true } } },
      },
    },
  });
  if (!match) notFound();

  const { teamA, teamB } = match;
  const decided = !!match.winnerTeamId;
  const completedGames = match.games.filter((g) => g.state === "completed");

  const mapTabs: MapTab[] = completedGames.map((game) => {
    const rows: (StatRow & { teamId: number })[] = game.stats.map((s) => ({
      id: s.id,
      teamId: s.teamId,
      role: s.role,
      champions: [s.champion],
      keystone: s.keystone,
      secondaryTree: s.secondaryTree,
      items: parseItems(s.items),
      kills: s.kills,
      deaths: s.deaths,
      assists: s.assists,
      creepScore: s.creepScore,
      totalGold: s.totalGold,
      player: { handle: s.player.handle },
    }));
    // Every player on a team shares the same side for a given game.
    const teamASide = game.stats.find((s) => s.teamId === teamA.id)?.side ?? null;
    const teamBSide = game.stats.find((s) => s.teamId === teamB.id)?.side ?? null;

    const summary: GameSummaryData = {
      teamASide,
      teamBSide,
      teamAKills: rows.filter((r) => r.teamId === teamA.id).reduce((sum, r) => sum + r.kills, 0),
      teamBKills: rows.filter((r) => r.teamId === teamB.id).reduce((sum, r) => sum + r.kills, 0),
      teamADragons: parseCommaList(game.teamADragons),
      teamBDragons: parseCommaList(game.teamBDragons),
      teamABarons: game.teamABarons ?? 0,
      teamBBarons: game.teamBBarons ?? 0,
      teamAGold: game.teamAGold ?? 0,
      teamBGold: game.teamBGold ?? 0,
      teamAVoidGrubs: game.teamAVoidGrubs,
      teamBVoidGrubs: game.teamBVoidGrubs,
      teamARiftHeralds: game.teamARiftHeralds,
      teamBRiftHeralds: game.teamBRiftHeralds,
      teamABans: parseCommaList(game.teamABans),
      teamBBans: parseCommaList(game.teamBBans),
    };

    return {
      key: String(game.id),
      label: `Match ${game.number}`,
      teamAStats: rows.filter((r) => r.teamId === teamA.id).sort(byRole),
      teamBStats: rows.filter((r) => r.teamId === teamB.id).sort(byRole),
      teamASide,
      teamBSide,
      summary,
    };
  });

  // "All Matches": sum each player's stats across every completed game. A
  // player keeps the same role/team throughout a series, but may have played
  // different champions per game, so those get joined rather than overwritten.
  // Side and item build are per-game concepts (sides swap, builds don't stack
  // meaningfully across games), so neither applies to this combined view.
  const combined = aggregateAcrossGames(completedGames, teamA.id, teamB.id);
  const tabs: MapTab[] =
    mapTabs.length > 1
      ? [{ key: "all", label: "All Matches", teamASide: null, teamBSide: null, summary: null, ...combined }, ...mapTabs]
      : mapTabs;

  return (
    <main className="container">
      <a className="back-link" href="/matches">
        ← All matches
      </a>

      <div className="match-header">
        <div className="side" style={{ opacity: decided && match.winnerTeamId !== teamA.id ? 0.5 : 1 }}>
          {teamA.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="team-logo" src={teamA.logoUrl} alt="" style={{ width: 28, height: 28 }} />
          )}
          {teamA.code}
        </div>
        <div className="big-score">
          <span className={decided ? (match.winnerTeamId === teamA.id ? "score-win" : "score-lose") : undefined}>
            {match.scoreA}
          </span>
          {" – "}
          <span className={decided ? (match.winnerTeamId === teamB.id ? "score-win" : "score-lose") : undefined}>
            {match.scoreB}
          </span>
        </div>
        <div className="side" style={{ opacity: decided && match.winnerTeamId !== teamB.id ? 0.5 : 1 }}>
          {teamB.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="team-logo" src={teamB.logoUrl} alt="" style={{ width: 28, height: 28 }} />
          )}
          {teamB.code}
        </div>
      </div>
      <div className="match-sub">
        {match.league.name} · Best of {match.bestOf} ·{" "}
        {match.startTime.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
      </div>

      {tabs.length > 0 ? (
        <MatchTabs teamAName={teamA.name} teamBName={teamB.name} tabs={tabs} />
      ) : (
        <p className="empty">No completed games yet.</p>
      )}
    </main>
  );
}

type CompletedGame = {
  stats: {
    playerId: number;
    teamId: number;
    side: string;
    role: string;
    champion: string;
    items: string | null;
    kills: number;
    deaths: number;
    assists: number;
    creepScore: number;
    totalGold: number;
    player: { handle: string };
  }[];
};

function aggregateAcrossGames(games: CompletedGame[], teamAId: number, teamBId: number) {
  const byPlayer = new Map<
    number,
    {
      teamId: number;
      role: string;
      handle: string;
      champions: Set<string>;
      kills: number;
      deaths: number;
      assists: number;
      creepScore: number;
      totalGold: number;
    }
  >();

  for (const game of games) {
    for (const s of game.stats) {
      let agg = byPlayer.get(s.playerId);
      if (!agg) {
        agg = {
          teamId: s.teamId,
          role: s.role,
          handle: s.player.handle,
          champions: new Set(),
          kills: 0,
          deaths: 0,
          assists: 0,
          creepScore: 0,
          totalGold: 0,
        };
        byPlayer.set(s.playerId, agg);
      }
      agg.champions.add(s.champion);
      agg.kills += s.kills;
      agg.deaths += s.deaths;
      agg.assists += s.assists;
      agg.creepScore += s.creepScore;
      agg.totalGold += s.totalGold;
    }
  }

  const rows: (StatRow & { teamId: number })[] = [...byPlayer.entries()].map(([playerId, a]) => ({
    id: playerId,
    teamId: a.teamId,
    role: a.role,
    champions: [...a.champions],
    keystone: null, // a player may run different keystones per game — no single value to show combined
    secondaryTree: null,
    items: [],
    kills: a.kills,
    deaths: a.deaths,
    assists: a.assists,
    creepScore: a.creepScore,
    totalGold: a.totalGold,
    player: { handle: a.handle },
  }));

  return {
    teamAStats: rows.filter((r) => r.teamId === teamAId).sort(byRole),
    teamBStats: rows.filter((r) => r.teamId === teamBId).sort(byRole),
  };
}
