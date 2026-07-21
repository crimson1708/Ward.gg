import { formatShortDate, humanizeTournamentSlug } from "@/lib/format";

type EventTournament = {
  id: number;
  slug: string;
  startDate: Date | null;
  endDate: Date | null;
  league: { name: string; region: string; logoUrl: string | null };
};

// Regions come back as full names ("LATIN AMERICA NORTH"), too long for a
// small badge — collapse multi-word ones to initials, keep short ones as-is.
function abbreviateRegion(region: string): string {
  const words = region.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.map((w) => w[0].toUpperCase()).join("");
}

export function EventRow({ tournament }: { tournament: EventTournament }) {
  const range =
    tournament.startDate && tournament.endDate
      ? `${formatShortDate(tournament.startDate)} - ${formatShortDate(tournament.endDate)}`
      : null;
  const badge = abbreviateRegion(tournament.league.region || tournament.league.name);
  const logo = tournament.league.logoUrl;

  return (
    <div className="event-row">
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="event-logo" src={logo} alt="" />
      ) : (
        <div className="event-badge">{badge}</div>
      )}
      <div className="event-info">
        <div className="event-name">{humanizeTournamentSlug(tournament.slug)}</div>
        {range && (
          <div className="event-range">
            <span className="event-league">{tournament.league.name}</span> {range}
          </div>
        )}
      </div>
    </div>
  );
}
