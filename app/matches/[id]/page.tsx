import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Show players in lane order rather than however the API returned them.
const ROLE_ORDER = ["top", "jungle", "mid", "bottom", "support"];
function byRole<T extends { role: string }>(a: T, b: T) {
  return ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
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

  return (
    <main className="container">
      <a className="back-link" href="/">
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
          {match.scoreA} – {match.scoreB}
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

      {match.games
        .filter((g) => g.state === "completed")
        .map((game) => {
          const teamAStats = game.stats.filter((s) => s.teamId === teamA.id).sort(byRole);
          const teamBStats = game.stats.filter((s) => s.teamId === teamB.id).sort(byRole);

          return (
            <div key={game.id} className="game-block">
              <h3>Game {game.number}</h3>
              {game.stats.length === 0 ? (
                <p className="empty">No stats recorded for this game.</p>
              ) : (
                <>
                  <BoxScore teamName={teamA.name} rows={teamAStats} />
                  <BoxScore teamName={teamB.name} rows={teamBStats} />
                </>
              )}
            </div>
          );
        })}
    </main>
  );
}

type StatRow = {
  id: number;
  role: string;
  champion: string;
  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
  totalGold: number;
  player: { handle: string };
};

function BoxScore({ teamName, rows }: { teamName: string; rows: StatRow[] }) {
  return (
    <table className="boxscore">
      <thead>
        <tr className="team-caption">
          <th colSpan={2}>{teamName}</th>
          <th className="num">K / D / A</th>
          <th className="num">CS</th>
          <th className="num">Gold</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.id}>
            <td>
              <div>{s.player.handle}</div>
              <div className="role">{s.role}</div>
            </td>
            <td>{s.champion}</td>
            <td className="num">
              {s.kills} / {s.deaths} / {s.assists}
            </td>
            <td className="num">{s.creepScore}</td>
            <td className="num">{s.totalGold.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
