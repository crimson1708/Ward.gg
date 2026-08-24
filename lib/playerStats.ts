// Champion-stat aggregation for the player pages.
//
// All three time windows are computed in ONE pass over a player's games so the
// page can ship every window to the client at once and make the filter an
// instant toggle rather than a refetch — a player's whole history is a few
// hundred rows, far cheaper to aggregate three times than to round-trip.

// How far back each window reaches. See DEFAULT_WINDOW below for why 60d is
// the default rather than 30d or all-time.
export const STAT_WINDOWS = [
  { key: "30d", label: "30 days", days: 30 },
  { key: "60d", label: "60 days", days: 60 },
  { key: "all", label: "All time", days: null },
] as const;

export type StatWindowKey = (typeof STAT_WINDOWS)[number]["key"];

// Champion win rates age badly: a champion that was dominant two patches ago
// and has since been gutted still shows a glittering all-time win rate, which
// is exactly the misleading number a stats page shouldn't lead with. So the
// default window is deliberately recent.
//
// 60 days rather than 30 because sample size is the competing failure mode:
// pros play ~2-6 games a week, so a 30-day window leaves many champions
// sitting on 1-2 games, where a single win reads as "100% win rate". 60 days
// roughly doubles that while still staying inside the current meta — about a
// split's worth of play. Rows below MIN_CONFIDENT_GAMES are additionally
// marked low-sample in the UI, and the table sorts by games played rather
// than win rate, so a 1-game 100% never floats to the top.
export const DEFAULT_WINDOW: StatWindowKey = "60d";

// Below this, a win rate is presentational noise rather than a measurement.
export const MIN_CONFIDENT_GAMES = 3;

export interface ChampionStatRow {
  champion: string;
  games: number;
  wins: number;
  losses: number;
  /** Null when no game on this champion has a known winner yet. */
  winRate: number | null;
  /** Games backing winRate — the winner is inferred per game and can be absent. */
  gamesWithResult: number;
  /** Share of the player's games in this window that were on this champion. */
  pickRate: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  /** (K+A)/D, with a deathless sample counted as one death — see kdaRatio. */
  kda: number;
  /** Null until duration data exists for at least one game on this champion. */
  csPerMin: number | null;
  goldPerMin: number | null;
  /** Games backing csPerMin/goldPerMin. */
  gamesWithDuration: number;
  /** Share of the team's kills the player was involved in. */
  killParticipation: number | null;
  lowSample: boolean;
}

export interface PlayerWindowStats {
  games: number;
  wins: number;
  losses: number;
  winRate: number | null;
  gamesWithResult: number;
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  kda: number;
  csPerMin: number | null;
  goldPerMin: number | null;
  killParticipation: number | null;
  champions: ChampionStatRow[];
}

/** One of the player's game appearances, flattened out of the Prisma shape. */
export interface PlayerGameAppearance {
  champion: string;
  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
  totalGold: number;
  teamId: number;
  startTime: Date;
  durationSecs: number | null;
  /** Null when the game's winner hasn't been determined yet. */
  winnerTeamId: number | null;
  /** Total kills by the player's own team in that game, for kill participation. */
  teamKills: number | null;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

// A deathless sample is counted as a single death rather than reported as
// "Perfect": an unbounded rating sorts and compares badly against every other
// row, and (K+A)/1 stays on the same scale as the rest of the column.
function kdaRatio(kills: number, deaths: number, assists: number): number {
  return (kills + assists) / Math.max(deaths, 1);
}

function aggregate(appearances: PlayerGameAppearance[]): {
  kills: number; deaths: number; assists: number; cs: number; gold: number;
  wins: number; losses: number; withResult: number; minutes: number; withDuration: number;
  killsPlusAssists: number; teamKills: number; withTeamKills: number;
} {
  const acc = {
    kills: 0, deaths: 0, assists: 0, cs: 0, gold: 0,
    wins: 0, losses: 0, withResult: 0, minutes: 0, withDuration: 0,
    killsPlusAssists: 0, teamKills: 0, withTeamKills: 0,
  };
  for (const a of appearances) {
    acc.kills += a.kills;
    acc.deaths += a.deaths;
    acc.assists += a.assists;
    if (a.winnerTeamId !== null) {
      acc.withResult++;
      if (a.winnerTeamId === a.teamId) acc.wins++;
      else acc.losses++;
    }
    // CS/min and gold/min are computed only over games whose length we know,
    // so a partially-backfilled dataset yields a correct rate over a smaller
    // sample rather than a rate silently deflated by missing minutes.
    if (a.durationSecs !== null && a.durationSecs > 0) {
      acc.withDuration++;
      acc.minutes += a.durationSecs / 60;
      acc.cs += a.creepScore;
      acc.gold += a.totalGold;
    }
    if (a.teamKills !== null && a.teamKills > 0) {
      acc.withTeamKills++;
      acc.teamKills += a.teamKills;
      acc.killsPlusAssists += a.kills + a.assists;
    }
  }
  return acc;
}

function buildChampionRow(champion: string, appearances: PlayerGameAppearance[], windowGames: number): ChampionStatRow {
  const a = aggregate(appearances);
  const n = appearances.length;
  return {
    champion,
    games: n,
    wins: a.wins,
    losses: a.losses,
    winRate: ratio(a.wins, a.withResult),
    gamesWithResult: a.withResult,
    pickRate: windowGames > 0 ? n / windowGames : 0,
    avgKills: a.kills / n,
    avgDeaths: a.deaths / n,
    avgAssists: a.assists / n,
    kda: kdaRatio(a.kills, a.deaths, a.assists),
    csPerMin: ratio(a.cs, a.minutes),
    goldPerMin: ratio(a.gold, a.minutes),
    gamesWithDuration: a.withDuration,
    killParticipation: ratio(a.killsPlusAssists, a.teamKills),
    lowSample: n < MIN_CONFIDENT_GAMES,
  };
}

export function computeWindowStats(all: PlayerGameAppearance[], days: number | null, now = new Date()): PlayerWindowStats {
  const cutoff = days === null ? null : new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const inWindow = cutoff ? all.filter((a) => a.startTime >= cutoff) : all;

  const byChampion = new Map<string, PlayerGameAppearance[]>();
  for (const a of inWindow) {
    const list = byChampion.get(a.champion);
    if (list) list.push(a);
    else byChampion.set(a.champion, [a]);
  }

  const overall = aggregate(inWindow);
  const n = inWindow.length;

  const champions = [...byChampion.entries()]
    .map(([champion, apps]) => buildChampionRow(champion, apps, n))
    // Games played, not win rate — a 1-game 100% shouldn't lead the table.
    // Ties break on win rate so the most-played champions stay ordered sensibly.
    .sort((x, y) => y.games - x.games || (y.winRate ?? 0) - (x.winRate ?? 0));

  return {
    games: n,
    wins: overall.wins,
    losses: overall.losses,
    winRate: ratio(overall.wins, overall.withResult),
    gamesWithResult: overall.withResult,
    avgKills: n > 0 ? overall.kills / n : 0,
    avgDeaths: n > 0 ? overall.deaths / n : 0,
    avgAssists: n > 0 ? overall.assists / n : 0,
    kda: kdaRatio(overall.kills, overall.deaths, overall.assists),
    csPerMin: ratio(overall.cs, overall.minutes),
    goldPerMin: ratio(overall.gold, overall.minutes),
    killParticipation: ratio(overall.killsPlusAssists, overall.teamKills),
    champions,
  };
}

export function computeAllWindows(all: PlayerGameAppearance[], now = new Date()): Record<StatWindowKey, PlayerWindowStats> {
  return {
    "30d": computeWindowStats(all, 30, now),
    "60d": computeWindowStats(all, 60, now),
    all: computeWindowStats(all, null, now),
  };
}
