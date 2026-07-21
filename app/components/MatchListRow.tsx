import { LocalTime } from "@/app/components/LocalTime";
import { formatCountdown, humanizeTournamentSlug } from "@/lib/format";

type ListMatch = {
  id: number;
  startTime: Date;
  status: string; // "unstarted" | "inProgress" | "completed"
  scoreA: number;
  scoreB: number;
  winnerTeamId: number | null;
  blockName: string | null;
  teamA: { id: number; name: string; code: string; logoUrl: string | null };
  teamB: { id: number; name: string; code: string; logoUrl: string | null };
  tournament: { slug: string } | null;
  league: { name: string; logoUrl: string | null };
};

// One VLR-style row: time-of-day (viewer-local) | teams | live/countdown/score
// | stage + tournament, with the league mark on the far right.
export function MatchListRow({ match }: { match: ListMatch }) {
  const decided = match.status === "completed";
  const tournamentName = match.tournament ? humanizeTournamentSlug(match.tournament.slug) : match.league.name;

  return (
    <a className="match-list-row" href={`/matches/${match.id}`}>
      <div className="mlr-time">
        <LocalTime iso={match.startTime.toISOString()} />
      </div>

      <div className="mlr-teams">
        <TeamName team={match.teamA} isWinner={decided && match.winnerTeamId === match.teamA.id} decided={decided} />
        <TeamName team={match.teamB} isWinner={decided && match.winnerTeamId === match.teamB.id} decided={decided} />
      </div>

      <div className="mlr-status">
        {match.status === "inProgress" ? (
          <span className="pill live">Live</span>
        ) : decided ? (
          <span className="mlr-score">
            {match.scoreA}–{match.scoreB}
          </span>
        ) : (
          <span className="pill upcoming">
            Upcoming <b>{formatCountdown(match.startTime)}</b>
          </span>
        )}
      </div>

      <div className="mlr-meta">
        <div className="mlr-meta-text">
          {match.blockName && <div className="mlr-stage">{match.blockName}</div>}
          <div className="mlr-tournament">{tournamentName}</div>
        </div>
        {match.league.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="event-logo" src={match.league.logoUrl} alt="" />
        )}
      </div>
    </a>
  );
}

function TeamName({
  team,
  isWinner,
  decided,
}: {
  team: { name: string; logoUrl: string | null };
  isWinner: boolean;
  decided: boolean;
}) {
  const cls = decided ? (isWinner ? "mlr-team winner" : "mlr-team loser") : "mlr-team";
  return (
    <div className={cls}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {team.logoUrl && <img className="team-logo" src={team.logoUrl} alt="" />}
      <span>{team.name}</span>
    </div>
  );
}
