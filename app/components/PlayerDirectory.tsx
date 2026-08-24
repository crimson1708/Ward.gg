"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MIN_CONFIDENT_GAMES } from "@/lib/playerStats";

export interface PlayerListEntry {
  id: number;
  handle: string;
  realName: string | null;
  /** Flag emoji, or the country name when we have no flag for it. */
  countryFlag: string | null;
  countryName: string | null;
  role: string | null;
  teamName: string | null;
  teamCode: string | null;
  teamLogo: string | null;
  teamSlug: string | null;
  region: string | null;
  games: number;
  wins: number;
  losses: number;
  winRate: number | null;
  gamesWithResult: number;
}

const ROLE_FILTERS = [
  { key: "all", label: "All" },
  { key: "top", label: "Top" },
  { key: "jungle", label: "Jungle" },
  { key: "mid", label: "Mid" },
  { key: "bottom", label: "Bot" },
  { key: "support", label: "Support" },
] as const;

const ROLE_LABELS: Record<string, string> = {
  top: "Top", jungle: "Jungle", mid: "Mid", bottom: "Bot", support: "Support",
};

// A win rate is only as good as the number of games actually behind it, which
// is not the same as the games played: a game's winner is inferred from its
// final frame and may not be resolved yet.
function resolvedTitle(p: PlayerListEntry): string {
  if (p.gamesWithResult === 0) return `No results resolved yet of ${p.games} games`;
  if (p.gamesWithResult < p.games) return `Based on ${p.gamesWithResult} of ${p.games} games`;
  return `Based on all ${p.games} games`;
}

function winRateClass(p: PlayerListEntry): string {
  if (p.winRate === null || p.gamesWithResult < MIN_CONFIDENT_GAMES) return "";
  if (p.winRate >= 0.6) return "wr-high";
  if (p.winRate <= 0.4) return "wr-low";
  return "";
}

export function PlayerDirectory({ players }: { players: PlayerListEntry[] }) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<string>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return players.filter((p) => {
      if (role !== "all" && p.role !== role) return false;
      if (!q) return true;
      // Match on anything a person might plausibly type: the in-game name,
      // the real name, or either form of the team.
      return (
        p.handle.toLowerCase().includes(q) ||
        (p.realName?.toLowerCase().includes(q) ?? false) ||
        (p.teamName?.toLowerCase().includes(q) ?? false) ||
        (p.teamCode?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [players, query, role]);

  return (
    <>
      <div className="directory-controls">
        <input
          className="player-search"
          type="search"
          placeholder="Search player, real name or team…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search players"
        />
        <div className="role-filters">
          {ROLE_FILTERS.map((r) => (
            <button
              key={r.key}
              className={`role-filter ${role === r.key ? "active" : ""}`}
              onClick={() => setRole(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <p className="directory-count">
        {filtered.length} player{filtered.length === 1 ? "" : "s"}
        {filtered.length !== players.length && ` of ${players.length}`}
      </p>

      {filtered.length === 0 ? (
        <p className="empty">No players match that search.</p>
      ) : (
        <div className="table-scroll">
          <table className="player-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Role</th>
                <th>Team</th>
                <th className="num">G</th>
                <th className="num">W-L</th>
                <th className="num">Win%</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link className="player-link" href={`/players/${p.id}`}>
                      {p.countryFlag && (
                        <span className="player-flag-sm" title={p.countryName ?? undefined}>
                          {p.countryFlag}
                        </span>
                      )}
                      <span className="player-name">{p.handle}</span>
                      {p.realName && <span className="player-realname-sm">{p.realName}</span>}
                    </Link>
                  </td>
                  <td className="role-cell">{p.role ? ROLE_LABELS[p.role] ?? p.role : "—"}</td>
                  <td>
                    {p.teamName ? (
                      <span className="team-cell">
                        {p.teamLogo && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className="team-logo-sm" src={p.teamLogo} alt="" loading="lazy" />
                        )}
                        <span>{p.teamCode ?? p.teamName}</span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="num">{p.games}</td>
                  <td className="num" title={resolvedTitle(p)}>
                    {p.gamesWithResult > 0 ? (
                      <>
                        {p.wins}-{p.losses}
                        {p.gamesWithResult < p.games && <span className="partial-note"> of {p.games}</span>}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  {/* Below the threshold the percentage is withheld entirely
                      rather than shown greyed out: a "0%" next to 46 games
                      (because only 2 of them have a resolved winner so far)
                      reads as a real, terrible win rate, which is worse than
                      showing nothing. */}
                  <td className={`num ${winRateClass(p)}`} title={resolvedTitle(p)}>
                    {p.winRate === null || p.gamesWithResult < MIN_CONFIDENT_GAMES
                      ? "—"
                      : `${Math.round(p.winRate * 100)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
