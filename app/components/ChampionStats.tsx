"use client";

import { useState } from "react";
import {
  STAT_WINDOWS,
  DEFAULT_WINDOW,
  MIN_CONFIDENT_GAMES,
  type StatWindowKey,
  type ChampionStatRow,
  type PlayerWindowStats,
} from "@/lib/playerStats";

// Champion name/icon are resolved on the server so the champion-name JSON
// never has to ship to the browser.
export interface ChampionRowDisplay extends ChampionStatRow {
  name: string;
  iconUrl: string | null;
}

export interface WindowDisplay extends Omit<PlayerWindowStats, "champions"> {
  champions: ChampionRowDisplay[];
}

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const dec = (v: number | null, places = 1) => (v === null ? "—" : v.toFixed(places));
const kdaLabel = (v: number) => v.toFixed(2);

// Win rate gets a colour cue, but only once the sample is big enough to mean
// anything — colouring a 1-game 100% green is the exact overstatement the
// low-sample handling elsewhere is trying to avoid.
// The win rate's real denominator is the games whose winner is resolved, which
// can lag the games played — say so on hover rather than letting the two
// numbers silently disagree.
function resolvedTitle(row: { games: number; gamesWithResult: number }): string {
  if (row.gamesWithResult === 0) return `No results resolved yet of ${row.games} games`;
  if (row.gamesWithResult < row.games) return `Based on ${row.gamesWithResult} of ${row.games} games`;
  return `Based on all ${row.games} games`;
}

function winRateClass(row: { winRate: number | null; gamesWithResult: number }): string {
  if (row.winRate === null || row.gamesWithResult < MIN_CONFIDENT_GAMES) return "";
  if (row.winRate >= 0.6) return "wr-high";
  if (row.winRate <= 0.4) return "wr-low";
  return "";
}

export function ChampionStats({ windows }: { windows: Record<StatWindowKey, WindowDisplay> }) {
  const [windowKey, setWindowKey] = useState<StatWindowKey>(DEFAULT_WINDOW);
  const stats = windows[windowKey];

  // Whether the numbers below are backed by every game in the window, or only
  // the subset that has been resolved so far. Stated outright rather than
  // quietly averaging over whatever happens to be present.
  const missingResults = stats.games - stats.gamesWithResult;

  return (
    <>
      <div className="stats-toolbar">
        <div className="window-tabs" role="tablist" aria-label="Stat time range">
          {STAT_WINDOWS.map((w) => (
            <button
              key={w.key}
              role="tab"
              aria-selected={windowKey === w.key}
              className={`window-tab ${windowKey === w.key ? "active" : ""}`}
              onClick={() => setWindowKey(w.key)}
            >
              {w.label}
            </button>
          ))}
        </div>
        <span className="window-hint">
          {windowKey === "all" ? "Every game on record" : "Recent form — keeps win rates inside the current meta"}
        </span>
      </div>

      {stats.games === 0 ? (
        <p className="empty">No games in this window.</p>
      ) : (
        <>
          <div className="stat-summary">
            <div className="stat-cell">
              <span className="stat-label">Games</span>
              <span className="stat-value">{stats.games}</span>
            </div>
            <div className="stat-cell">
              <span className="stat-label">Record</span>
              <span className="stat-value">
                {stats.gamesWithResult > 0 ? `${stats.wins}-${stats.losses}` : "—"}
              </span>
            </div>
            <div className="stat-cell">
              <span className="stat-label">Win rate</span>
              <span className={`stat-value ${winRateClass(stats)}`}>{pct(stats.winRate)}</span>
            </div>
            <div className="stat-cell">
              <span className="stat-label">KDA</span>
              <span className="stat-value">{kdaLabel(stats.kda)}</span>
              <span className="stat-sub">
                {dec(stats.avgKills)} / {dec(stats.avgDeaths)} / {dec(stats.avgAssists)}
              </span>
            </div>
            <div className="stat-cell">
              <span className="stat-label">CS/min</span>
              <span className="stat-value">{dec(stats.csPerMin)}</span>
            </div>
            <div className="stat-cell">
              <span className="stat-label">Gold/min</span>
              <span className="stat-value">{stats.goldPerMin === null ? "—" : Math.round(stats.goldPerMin)}</span>
            </div>
            <div className="stat-cell">
              <span className="stat-label">Kill part.</span>
              <span className="stat-value">{pct(stats.killParticipation)}</span>
            </div>
          </div>

          {missingResults > 0 && (
            <p className="stat-note">
              Win rates cover {stats.gamesWithResult} of {stats.games} games — the rest are still being resolved.
            </p>
          )}

          <div className="table-scroll">
            <table className="champ-stats">
              <thead>
                <tr>
                  <th className="champ-col">Champion</th>
                  <th className="num">G</th>
                  <th className="num">W-L</th>
                  <th className="num">Win%</th>
                  <th className="num">Pick%</th>
                  <th className="num">KDA</th>
                  <th className="num">K / D / A</th>
                  <th className="num">CS/M</th>
                  <th className="num">GPM</th>
                  <th className="num">KP%</th>
                </tr>
              </thead>
              <tbody>
                {stats.champions.map((c) => (
                  <tr key={c.champion} className={c.lowSample ? "low-sample" : ""}>
                    <td className="champ-col">
                      <span className="champ-cell">
                        {c.iconUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className="champ-icon" src={c.iconUrl} alt="" loading="lazy" />
                        ) : (
                          <span className="champ-icon placeholder" />
                        )}
                        <span className="champ-name">{c.name}</span>
                      </span>
                    </td>
                    <td className="num">{c.games}</td>
                    <td className="num" title={resolvedTitle(c)}>
                      {c.gamesWithResult > 0 ? (
                        <>
                          {c.wins}-{c.losses}
                          {/* A record that doesn't add up to G looks like a
                              bug unless the shortfall is stated: say how many
                              of the games it actually covers. */}
                          {c.gamesWithResult < c.games && (
                            <span className="partial-note"> of {c.games}</span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={`num ${winRateClass(c)}`} title={resolvedTitle(c)}>
                      {pct(c.winRate)}
                    </td>
                    <td className="num">{pct(c.pickRate)}</td>
                    <td className="num">{kdaLabel(c.kda)}</td>
                    <td className="num muted-cell">
                      {dec(c.avgKills)} / {dec(c.avgDeaths)} / {dec(c.avgAssists)}
                    </td>
                    <td className="num">{dec(c.csPerMin)}</td>
                    <td className="num">{c.goldPerMin === null ? "—" : Math.round(c.goldPerMin)}</td>
                    <td className="num">{pct(c.killParticipation)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
