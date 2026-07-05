// Thin client for the LoL Esports API. Its only job is to fetch + return JSON.
// It knows nothing about our database — that separation keeps things testable
// and means we could swap data sources later without touching ingestion logic.

const API_KEY = "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z"; // public shared key
const ESPORTS = "https://esports-api.lolesports.com/persisted/gw";

async function get(path: string) {
  const res = await fetch(`${ESPORTS}/${path}`, {
    headers: { "x-api-key": API_KEY },
  });
  if (!res.ok) {
    throw new Error(`LoL Esports API ${path} failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

// ── Types describing ONLY the fields we actually use (from the raw JSON we
//    inspected). Partial on purpose — the API returns much more. ──

export interface ApiLeague {
  id: string;
  slug: string;
  name: string;
  region: string;
}

export interface ApiScheduleTeam {
  name: string;
  code: string;
  image: string;
  result: { outcome: string | null; gameWins: number } | null;
}

export interface ApiScheduleEvent {
  startTime: string;
  state: string; // unstarted | inProgress | completed
  type: string; // "match" | "show" ...
  league: { name: string; slug: string };
  match?: {
    id: string;
    teams: ApiScheduleTeam[];
    strategy: { type: string; count: number };
  };
}

export async function getLeagues(): Promise<ApiLeague[]> {
  const data = await get("getLeagues?hl=en-US");
  return data.data.leagues;
}

export async function getSchedule(): Promise<ApiScheduleEvent[]> {
  const data = await get("getSchedule?hl=en-US");
  return data.data.schedule.events;
}

// ── Match detail: the games inside a series, with REAL team ids + side mapping ──

export interface ApiEventTeam {
  id: string;
  name: string;
  code: string;
  image: string;
}

export interface ApiGame {
  number: number;
  id: string;
  state: string; // completed | unneeded | inProgress | unstarted
  teams: { id: string; side: string }[]; // side = "blue" | "red"
}

export async function getEventDetails(
  matchId: string
): Promise<{ teams: ApiEventTeam[]; games: ApiGame[] }> {
  const data = await get(`getEventDetails?hl=en-US&id=${matchId}`);
  const m = data.data.event.match;
  return { teams: m.teams, games: m.games };
}

// ── Per-game live stats, from the SEPARATE feed host (no api key needed) ──

const FEED = "https://feed.lolesports.com/livestats/v1";

export interface WindowPlayerMeta {
  participantId: number;
  esportsPlayerId: string;
  summonerName: string;
  championId: string;
  role: string;
}

export interface WindowPlayerStat {
  participantId: number;
  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
  totalGold: number;
}

export interface GameWindow {
  gameMetadata: {
    blueTeamMetadata: { participantMetadata: WindowPlayerMeta[] };
    redTeamMetadata: { participantMetadata: WindowPlayerMeta[] };
  };
  frames: {
    gameState: string;
    blueTeam: { participants: WindowPlayerStat[] };
    redTeam: { participants: WindowPlayerStat[] };
  }[];
}

// ── Teams & rosters (the source for team/player pages) ──

export interface ApiRosterPlayer {
  id: string;
  summonerName: string;
  firstName?: string;
  lastName?: string;
  image?: string;
  role: string;
}

export interface ApiTeam {
  id: string;
  slug: string;
  name: string;
  code: string;
  image: string;
  homeLeague: { name: string; region: string } | null;
  players: ApiRosterPlayer[];
}

// Pass a team slug to fetch one team; omit for ALL teams (~1500).
export async function getTeams(teamSlug?: string): Promise<ApiTeam[]> {
  const query = teamSlug ? `getTeams?hl=en-US&id=${teamSlug}` : "getTeams?hl=en-US";
  const data = await get(query);
  return data.data.teams;
}

// ── Tournaments & standings (for league tables) ──

export interface ApiTournament {
  id: string;
  slug: string;
  startDate: string;
  endDate: string;
}

export async function getTournamentsForLeague(leagueId: string): Promise<ApiTournament[]> {
  const data = await get(`getTournamentsForLeague?hl=en-US&leagueId=${leagueId}`);
  return data.data.leagues?.[0]?.tournaments ?? [];
}

// Standings are deeply nested (stages → sections → rankings). Returned raw here;
// we can shape it when we actually build the standings UI.
export async function getStandings(tournamentId: string) {
  const data = await get(`getStandings?hl=en-US&tournamentId=${tournamentId}`);
  return data.data.standings;
}

// Round a timestamp DOWN to the nearest 10 seconds and return ISO — the feed
// endpoint only accepts 10-second-aligned times.
function roundTo10s(ms: number): string {
  return new Date(Math.floor(ms / 10_000) * 10_000).toISOString();
}

// Fetch the FINAL box score for a finished game. We don't know exactly when each
// game ended, so we request escalating offsets from the series start until the
// feed returns finished data. Returns null when no stats exist (e.g. minor leagues).
export async function getGameWindow(
  gameId: string,
  seriesStartMs: number
): Promise<GameWindow | null> {
  for (const hours of [3, 6, 9, 12]) {
    const startingTime = roundTo10s(seriesStartMs + hours * 3_600_000);
    const res = await fetch(`${FEED}/window/${gameId}?startingTime=${startingTime}`);
    if (res.status === 204) continue; // time was before this game started — try later
    if (!res.ok) return null; // no feed for this game
    const text = await res.text();
    try {
      const json = JSON.parse(text) as GameWindow;
      if (json.frames?.length) return json;
    } catch {
      return null;
    }
  }
  return null;
}
