import { prisma } from "@/lib/prisma";

// Always render fresh from the DB on each request (rather than caching a
// snapshot at build time). Good for live scores; we can optimize caching later.
export const dynamic = "force-dynamic";

// A Match with its relations included — the shape our query returns.
type MatchWithRelations = Awaited<ReturnType<typeof getMatches>>[number];

async function getMatches() {
  return prisma.match.findMany({
    include: { league: true, teamA: true, teamB: true },
    orderBy: { startTime: "asc" },
  });
}

export default async function Home() {
  // This runs on the SERVER. The DB query and its results never reach the browser
  // — only the finished HTML does.
  const matches = await getMatches();

  const live = matches.filter((m) => m.status === "inProgress");
  const upcoming = matches.filter((m) => m.status === "unstarted");
  // Completed: most-recent first.
  const completed = matches
    .filter((m) => m.status === "completed")
    .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());

  return (
    <main className="container">
      {live.length > 0 && (
        <>
          <h2 className="section-title">Live</h2>
          {live.map((m) => (
            <MatchRow key={m.id} match={m} live />
          ))}
        </>
      )}

      <h2 className="section-title">Upcoming</h2>
      {upcoming.length > 0 ? (
        upcoming.map((m) => <MatchRow key={m.id} match={m} />)
      ) : (
        <p className="empty">No upcoming matches in the current window.</p>
      )}

      <h2 className="section-title">Results</h2>
      {completed.length > 0 ? (
        <div className="results-grid">
          {completed.map((m) => (
            <MatchRow key={m.id} match={m} />
          ))}
        </div>
      ) : (
        <p className="empty">No completed matches yet.</p>
      )}
    </main>
  );
}

function MatchRow({ match, live }: { match: MatchWithRelations; live?: boolean }) {
  const { teamA, teamB, scoreA, scoreB, winnerTeamId } = match;
  const when = match.startTime.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <a className="match" href={`/matches/${match.id}`}>
      <div className="meta">
        <div className="league">{match.league.name}</div>
        <div>{when}</div>
      </div>

      <div className="teams">
        <TeamLine team={teamA} isWinner={winnerTeamId === teamA.id} decided={!!winnerTeamId} />
        <TeamLine team={teamB} isWinner={winnerTeamId === teamB.id} decided={!!winnerTeamId} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {live ? (
          <span className="badge live">Live</span>
        ) : (
          <span className="badge bo">Bo{match.bestOf}</span>
        )}
        <div className="score">
          {scoreA}–{scoreB}
        </div>
      </div>
    </a>
  );
}

function TeamLine({
  team,
  isWinner,
  decided,
}: {
  team: { code: string; name: string; logoUrl: string | null };
  isWinner: boolean;
  decided: boolean;
}) {
  const cls = decided ? (isWinner ? "team-row winner" : "team-row loser") : "team-row";
  return (
    <div className={cls}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {team.logoUrl && <img className="team-logo" src={team.logoUrl} alt="" />}
      <span>{team.code}</span>
    </div>
  );
}
