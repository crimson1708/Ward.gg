import { prisma } from "@/lib/prisma";
import { MatchListRow } from "@/app/components/MatchListRow";

// Always render fresh from the DB on each request (rather than caching a
// snapshot at build time). Good for live scores; we can optimize caching later.
export const dynamic = "force-dynamic";

const UPCOMING_COUNT = 16;

async function getMatches() {
  const [live, upcoming, completed] = await Promise.all([
    prisma.match.findMany({
      where: { status: "inProgress" },
      orderBy: { startTime: "asc" },
      include: { league: true, teamA: true, teamB: true, tournament: true },
    }),
    prisma.match.findMany({
      // startTime >= now as well as status "unstarted": some minor-league
      // matches never get their status flipped to "completed" upstream, so
      // status alone can surface stale, already-past matches here.
      where: { status: "unstarted", startTime: { gte: new Date() } },
      orderBy: { startTime: "asc" },
      take: UPCOMING_COUNT,
      include: { league: true, teamA: true, teamB: true, tournament: true },
    }),
    prisma.match.findMany({
      where: { status: "completed" },
      orderBy: { startTime: "desc" },
      include: { league: true, teamA: true, teamB: true, tournament: true },
    }),
  ]);

  return { live, upcoming, completed };
}

export default async function MatchesPage() {
  const { live, upcoming, completed } = await getMatches();

  return (
    <main className="container">
      {live.length > 0 && (
        <>
          <h2 className="section-title">Live</h2>
          {live.map((m) => (
            <MatchListRow key={m.id} match={m} />
          ))}
        </>
      )}

      <h2 className="section-title">Upcoming</h2>
      {upcoming.length > 0 ? (
        upcoming.map((m) => <MatchListRow key={m.id} match={m} />)
      ) : (
        <p className="empty">No upcoming matches in the current window.</p>
      )}

      <h2 className="section-title">Results</h2>
      {completed.length > 0 ? (
        completed.map((m) => <MatchListRow key={m.id} match={m} />)
      ) : (
        <p className="empty">No completed matches yet.</p>
      )}
    </main>
  );
}
