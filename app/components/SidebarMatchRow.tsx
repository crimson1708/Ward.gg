import { formatCountdown } from "@/lib/format";

type SidebarMatch = {
  id: number;
  startTime: Date;
  status: string; // "unstarted" | "inProgress" | "completed"
  scoreA: number;
  scoreB: number;
  winnerTeamId: number | null;
  teamA: { id: number; code: string; logoUrl: string | null };
  teamB: { id: number; code: string; logoUrl: string | null };
};

// One compact row in the homepage sidebar. The right-hand side adapts to the
// match's state: a countdown when it hasn't started, a LIVE tag once it has,
// and the final score once it's decided.
export function SidebarMatchRow({ match }: { match: SidebarMatch }) {
  const decided = match.status === "completed";

  return (
    <a className="sidebar-match" href={`/matches/${match.id}`}>
      <div className="sidebar-match-teams">
        <TeamName team={match.teamA} isWinner={decided && match.winnerTeamId === match.teamA.id} decided={decided} />
        <TeamName team={match.teamB} isWinner={decided && match.winnerTeamId === match.teamB.id} decided={decided} />
      </div>
      {match.status === "inProgress" ? (
        <span className="badge live">Live</span>
      ) : match.status === "completed" ? (
        <div className="sidebar-match-score">
          {match.scoreA}–{match.scoreB}
        </div>
      ) : (
        <div className="sidebar-match-time">{formatCountdown(match.startTime)}</div>
      )}
    </a>
  );
}

function TeamName({
  team,
  isWinner,
  decided,
}: {
  team: { code: string; logoUrl: string | null };
  isWinner: boolean;
  decided: boolean;
}) {
  const cls = decided ? (isWinner ? "sidebar-match-team winner" : "sidebar-match-team loser") : "sidebar-match-team";
  return (
    <div className={cls}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {team.logoUrl && <img src={team.logoUrl} alt="" />}
      <span>{team.code}</span>
    </div>
  );
}
